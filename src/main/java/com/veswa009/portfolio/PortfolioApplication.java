package com.veswa009.portfolio;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.CountDownLatch;

public final class PortfolioApplication {
    private static final int DEFAULT_PORT = 8080;
    private static final String APP_NAME = "Personal Portfolio";

    private PortfolioApplication() {
    }

    public static void main(String[] args) throws IOException, InterruptedException {
        int port = readPort();
        PortfolioDataService dataService = new PortfolioDataService();
        StaticAssetHandler staticAssetHandler = new StaticAssetHandler();

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", exchange -> handleRequest(exchange, dataService, staticAssetHandler));
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();

        System.out.printf("%s running at http://localhost:%d/%n", APP_NAME, port);
        new CountDownLatch(1).await();
    }

    private static int readPort() {
        String configuredPort = Optional.ofNullable(System.getenv("PORT")).orElse("").trim();
        if (configuredPort.isEmpty()) {
            return DEFAULT_PORT;
        }

        try {
            int port = Integer.parseInt(configuredPort);
            if (port < 1 || port > 65_535) {
                throw new IllegalArgumentException("PORT must be between 1 and 65535.");
            }
            return port;
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("PORT must be a number.", exception);
        }
    }

    private static void handleRequest(
            HttpExchange exchange,
            PortfolioDataService dataService,
            StaticAssetHandler staticAssetHandler
    ) throws IOException {
        try {
            String path = Optional.ofNullable(exchange.getRequestURI().getPath()).orElse("/");

            if ("/api/portfolio".equals(path)) {
                if (rejectUnsupportedMethod(exchange)) {
                    return;
                }
                writeJson(exchange, HttpURLConnection.HTTP_OK, PortfolioJson.snapshot(dataService.loadSnapshot()));
                return;
            }

            if (path.startsWith("/api/investments/")) {
                if (rejectUnsupportedMethod(exchange)) {
                    return;
                }
                String slug = URLDecoder.decode(path.substring("/api/investments/".length()), StandardCharsets.UTF_8);
                PortfolioSnapshot snapshot = dataService.loadSnapshot();
                Optional<Investment> investment = snapshot.investments().stream()
                        .filter(item -> item.slug().equals(slug))
                        .findFirst();

                if (investment.isEmpty()) {
                    writeJson(exchange, HttpURLConnection.HTTP_NOT_FOUND, "{\"error\":\"Investment not found\"}");
                    return;
                }

                writeJson(exchange, HttpURLConnection.HTTP_OK, PortfolioJson.investment(investment.get(), snapshot));
                return;
            }

            if ("/health".equals(path)) {
                if (rejectUnsupportedMethod(exchange)) {
                    return;
                }
                writePlain(exchange, HttpURLConnection.HTTP_OK, "ok");
                return;
            }

            staticAssetHandler.handle(exchange);
        } catch (Exception exception) {
            exception.printStackTrace(System.err);
            if (!exchange.getResponseHeaders().containsKey("Content-Type")) {
                writeJson(exchange, HttpURLConnection.HTTP_INTERNAL_ERROR, "{\"error\":\"Unexpected server error\"}");
            }
        }
    }

    private static boolean rejectUnsupportedMethod(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)) {
            return false;
        }

        exchange.getResponseHeaders().set("Allow", "GET, HEAD");
        writePlain(exchange, HttpURLConnection.HTTP_BAD_METHOD, "Method not allowed");
        return true;
    }

    private static void writeJson(HttpExchange exchange, int status, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        send(exchange, status, body);
    }

    private static void writePlain(HttpExchange exchange, int status, String text) throws IOException {
        byte[] body = text.getBytes(StandardCharsets.UTF_8);
        Headers headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "text/plain; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        send(exchange, status, body);
    }

    private static void send(HttpExchange exchange, int status, byte[] body) throws IOException {
        if ("HEAD".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
            return;
        }

        exchange.sendResponseHeaders(status, body.length);
        try (var output = exchange.getResponseBody()) {
            output.write(body);
        }
    }

    private static final class StaticAssetHandler {
        private static final Map<String, String> CONTENT_TYPES = Map.ofEntries(
                Map.entry("html", "text/html; charset=utf-8"),
                Map.entry("css", "text/css; charset=utf-8"),
                Map.entry("js", "application/javascript; charset=utf-8"),
                Map.entry("json", "application/json; charset=utf-8"),
                Map.entry("svg", "image/svg+xml; charset=utf-8"),
                Map.entry("png", "image/png"),
                Map.entry("jpg", "image/jpeg"),
                Map.entry("jpeg", "image/jpeg"),
                Map.entry("webp", "image/webp"),
                Map.entry("ico", "image/x-icon")
        );

        void handle(HttpExchange exchange) throws IOException {
            if (rejectUnsupportedMethod(exchange)) {
                return;
            }

            String path = Optional.ofNullable(exchange.getRequestURI().getPath()).orElse("/");
            String resourcePath = resourcePath(path);
            byte[] body = loadResource(resourcePath);

            if (body == null && !path.contains(".")) {
                resourcePath = "static/index.html";
                body = loadResource(resourcePath);
            }

            if (body == null) {
                writePlain(exchange, HttpURLConnection.HTTP_NOT_FOUND, "Not found");
                return;
            }

            Headers headers = exchange.getResponseHeaders();
            headers.set("Content-Type", contentType(resourcePath));
            headers.set("Cache-Control", "no-cache");
            send(exchange, HttpURLConnection.HTTP_OK, body);
        }

        private String resourcePath(String requestPath) {
            String cleanPath = requestPath.replace('\\', '/');
            if (cleanPath.equals("/") || cleanPath.isBlank()) {
                return "static/index.html";
            }
            if (cleanPath.contains("..")) {
                return "static/index.html";
            }
            if (cleanPath.startsWith("/")) {
                cleanPath = cleanPath.substring(1);
            }
            return "static/" + cleanPath;
        }

        private byte[] loadResource(String resourcePath) throws IOException {
            try (InputStream input = PortfolioApplication.class.getClassLoader().getResourceAsStream(resourcePath)) {
                return input == null ? null : input.readAllBytes();
            }
        }

        private String contentType(String resourcePath) {
            int dotIndex = resourcePath.lastIndexOf('.');
            if (dotIndex < 0 || dotIndex == resourcePath.length() - 1) {
                return "application/octet-stream";
            }
            return CONTENT_TYPES.getOrDefault(resourcePath.substring(dotIndex + 1).toLowerCase(Locale.ROOT), "application/octet-stream");
        }
    }

    private static final class PortfolioDataService {
        private static final Path LOCAL_CSV_PATH = Path.of("data", "investments.csv");
        private static final String SAMPLE_CSV_RESOURCE = "data/sample-investments.csv";

        PortfolioSnapshot loadSnapshot() {
            LoadedCsv loadedCsv = loadCsv();
            List<String> warnings = new ArrayList<>(loadedCsv.warnings());
            List<Investment> investments = CsvPortfolioParser.parse(loadedCsv.csv(), warnings);

            if (investments.isEmpty()) {
                warnings.add("No investments were parsed. Check the CSV column names and values.");
            }

            investments = investments.stream()
                    .sorted(Comparator.comparing(Investment::currentValue).reversed())
                    .toList();

            return new PortfolioSnapshot(investments, loadedCsv.source(), warnings, Instant.now());
        }

        private LoadedCsv loadCsv() {
            List<String> warnings = new ArrayList<>();

            if (Files.isRegularFile(LOCAL_CSV_PATH)) {
                try {
                    return new LoadedCsv(Files.readString(LOCAL_CSV_PATH, StandardCharsets.UTF_8), LOCAL_CSV_PATH.toString(), warnings);
                } catch (IOException exception) {
                    warnings.add("Local data/investments.csv could not be read; falling back.");
                }
            }

            try (InputStream input = PortfolioApplication.class.getClassLoader().getResourceAsStream(SAMPLE_CSV_RESOURCE)) {
                if (input == null) {
                    warnings.add("Bundled sample CSV is missing.");
                    return new LoadedCsv("", "missing sample data", warnings);
                }
                return new LoadedCsv(new String(input.readAllBytes(), StandardCharsets.UTF_8), "bundled sample data", warnings);
            } catch (IOException exception) {
                warnings.add("Bundled sample CSV could not be read.");
                return new LoadedCsv("", "unavailable data", warnings);
            }
        }
    }

    private static final class CsvPortfolioParser {
        private static final List<DateTimeFormatter> DATE_FORMATTERS = List.of(
                DateTimeFormatter.ISO_LOCAL_DATE,
                DateTimeFormatter.ofPattern("dd-MM-uuuu"),
                DateTimeFormatter.ofPattern("dd/MM/uuuu"),
                DateTimeFormatter.ofPattern("MM/dd/uuuu")
        );

        static List<Investment> parse(String csv, List<String> warnings) {
            List<List<String>> rows = parseRows(csv);
            if (rows.isEmpty()) {
                return List.of();
            }

            Map<String, Integer> headers = headerMap(rows.getFirst());
            List<Investment> investments = new ArrayList<>();
            Map<String, Integer> slugs = new HashMap<>();

            for (int rowIndex = 1; rowIndex < rows.size(); rowIndex++) {
                List<String> row = rows.get(rowIndex);
                if (isBlankRow(row)) {
                    continue;
                }

                String name = cell(row, headers, "name", "investmentname", "holding");
                if (name.isBlank()) {
                    continue;
                }

                String type = withDefault(cell(row, headers, "type", "category", "assetclass"), "Other");
                String symbol = cell(row, headers, "symbol", "ticker", "code");
                BigDecimal quantity = parseDecimal(cell(row, headers, "quantity", "units", "shares"));
                BigDecimal investedAmount = parseDecimal(cell(row, headers, "investedamount", "invested", "cost", "costbasis"));
                BigDecimal currentValue = parseDecimal(cell(row, headers, "currentvalue", "marketvalue", "value"));
                LocalDate purchaseDate = parseDate(cell(row, headers, "purchasedate", "buydate", "startdate"), LocalDate.now());
                String platform = withDefault(cell(row, headers, "platform", "broker", "account"), "Manual");
                String riskLevel = withDefault(cell(row, headers, "risklevel", "risk"), "Medium");
                String notes = cell(row, headers, "notes", "note", "remarks");
                LocalDate lastUpdated = parseDate(cell(row, headers, "lastupdated", "updated", "asof"), LocalDate.now());
                String slug = uniqueSlug(slugSeed(type, name, symbol), slugs, investments.size() + 1);

                investments.add(new Investment(
                        slug,
                        type,
                        name,
                        symbol,
                        quantity,
                        investedAmount,
                        currentValue,
                        purchaseDate,
                        platform,
                        riskLevel,
                        notes,
                        lastUpdated
                ));
            }

            return investments;
        }

        private static List<List<String>> parseRows(String csv) {
            List<List<String>> rows = new ArrayList<>();
            List<String> row = new ArrayList<>();
            StringBuilder field = new StringBuilder();
            boolean quoted = false;

            for (int index = 0; index < csv.length(); index++) {
                char current = csv.charAt(index);

                if (quoted) {
                    if (current == '"') {
                        if (index + 1 < csv.length() && csv.charAt(index + 1) == '"') {
                            field.append('"');
                            index++;
                        } else {
                            quoted = false;
                        }
                    } else {
                        field.append(current);
                    }
                    continue;
                }

                if (current == '"') {
                    quoted = true;
                } else if (current == ',') {
                    row.add(field.toString().trim());
                    field.setLength(0);
                } else if (current == '\n') {
                    row.add(field.toString().trim());
                    addRow(rows, row);
                    row = new ArrayList<>();
                    field.setLength(0);
                } else if (current == '\r') {
                    if (index + 1 < csv.length() && csv.charAt(index + 1) == '\n') {
                        index++;
                    }
                    row.add(field.toString().trim());
                    addRow(rows, row);
                    row = new ArrayList<>();
                    field.setLength(0);
                } else {
                    field.append(current);
                }
            }

            row.add(field.toString().trim());
            addRow(rows, row);
            return rows;
        }

        private static void addRow(List<List<String>> rows, List<String> row) {
            if (!isBlankRow(row)) {
                rows.add(row);
            }
        }

        private static Map<String, Integer> headerMap(List<String> headers) {
            Map<String, Integer> indexByName = new HashMap<>();
            for (int index = 0; index < headers.size(); index++) {
                indexByName.put(normalizeHeader(headers.get(index)), index);
            }
            return indexByName;
        }

        private static String cell(List<String> row, Map<String, Integer> headers, String... names) {
            for (String name : names) {
                Integer index = headers.get(normalizeHeader(name));
                if (index != null && index >= 0 && index < row.size()) {
                    return row.get(index).trim();
                }
            }
            return "";
        }

        private static String normalizeHeader(String header) {
            return header == null ? "" : header.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        }

        private static boolean isBlankRow(List<String> row) {
            return row.stream().allMatch(value -> value == null || value.isBlank());
        }

        private static String withDefault(String value, String fallback) {
            return value == null || value.isBlank() ? fallback : value.trim();
        }

        private static BigDecimal parseDecimal(String value) {
            if (value == null || value.isBlank()) {
                return BigDecimal.ZERO;
            }

            String cleaned = value.replace(",", "").replaceAll("[^0-9.\\-]", "");
            if (cleaned.isBlank() || "-".equals(cleaned) || ".".equals(cleaned)) {
                return BigDecimal.ZERO;
            }

            try {
                return new BigDecimal(cleaned);
            } catch (NumberFormatException exception) {
                return BigDecimal.ZERO;
            }
        }

        private static LocalDate parseDate(String value, LocalDate fallback) {
            if (value == null || value.isBlank()) {
                return fallback;
            }

            for (DateTimeFormatter formatter : DATE_FORMATTERS) {
                try {
                    return LocalDate.parse(value.trim(), formatter);
                } catch (DateTimeParseException ignored) {
                    // Try the next common spreadsheet date format.
                }
            }

            return fallback;
        }

        private static String slugSeed(String type, String name, String symbol) {
            String seed = (type + "-" + name + "-" + symbol).toLowerCase(Locale.ROOT);
            String slug = seed.replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
            return slug.isBlank() ? "investment" : slug;
        }

        private static String uniqueSlug(String seed, Map<String, Integer> slugs, int fallbackNumber) {
            String base = seed.isBlank() ? "investment-" + fallbackNumber : seed;
            int count = slugs.merge(base, 1, Integer::sum);
            return count == 1 ? base : base + "-" + count;
        }
    }

    private static final class PortfolioJson {
        static String snapshot(PortfolioSnapshot snapshot) {
            List<CategorySummary> categories = CategorySummary.from(snapshot.investments());
            StringBuilder json = new StringBuilder(12_000);
            json.append('{');
            appendStringField(json, "appName", APP_NAME);
            appendComma(json);
            appendStringField(json, "brand", "veswa009 Portfolio");
            appendComma(json);
            appendStringField(json, "source", snapshot.source());
            appendComma(json);
            appendStringField(json, "generatedAt", snapshot.generatedAt().toString());
            appendComma(json);
            appendSummary(json, snapshot, categories);
            appendComma(json);
            appendCategories(json, categories);
            appendComma(json);
            appendWarnings(json, snapshot.warnings());
            appendComma(json);
            appendInvestments(json, snapshot.investments());
            json.append('}');
            return json.toString();
        }

        static String investment(Investment investment, PortfolioSnapshot snapshot) {
            StringBuilder json = new StringBuilder(4_000);
            json.append('{');
            appendInvestment(json, investment);
            appendComma(json);
            appendStringField(json, "source", snapshot.source());
            appendComma(json);
            appendStringField(json, "generatedAt", snapshot.generatedAt().toString());
            json.append('}');
            return json.toString();
        }

        private static void appendSummary(StringBuilder json, PortfolioSnapshot snapshot, List<CategorySummary> categories) {
            BigDecimal totalInvested = snapshot.totalInvested();
            BigDecimal totalCurrent = snapshot.totalCurrentValue();
            BigDecimal gainLoss = totalCurrent.subtract(totalInvested);
            json.append("\"summary\":{");
            appendNumberField(json, "investmentCount", BigDecimal.valueOf(snapshot.investments().size()));
            appendComma(json);
            appendNumberField(json, "categoryCount", BigDecimal.valueOf(categories.size()));
            appendComma(json);
            appendNumberField(json, "totalInvested", totalInvested);
            appendComma(json);
            appendNumberField(json, "totalCurrentValue", totalCurrent);
            appendComma(json);
            appendNumberField(json, "gainLoss", gainLoss);
            appendComma(json);
            appendNumberField(json, "returnPercent", percent(gainLoss, totalInvested));
            json.append('}');
        }

        private static void appendCategories(StringBuilder json, List<CategorySummary> categories) {
            json.append("\"categories\":[");
            for (int index = 0; index < categories.size(); index++) {
                CategorySummary category = categories.get(index);
                if (index > 0) {
                    appendComma(json);
                }

                json.append('{');
                appendStringField(json, "type", category.type());
                appendComma(json);
                appendNumberField(json, "investedAmount", category.investedAmount());
                appendComma(json);
                appendNumberField(json, "currentValue", category.currentValue());
                appendComma(json);
                appendNumberField(json, "gainLoss", category.gainLoss());
                appendComma(json);
                appendNumberField(json, "allocationPercent", category.allocationPercent());
                appendComma(json);
                appendNumberField(json, "returnPercent", category.returnPercent());
                json.append('}');
            }
            json.append(']');
        }

        private static void appendWarnings(StringBuilder json, List<String> warnings) {
            json.append("\"warnings\":[");
            for (int index = 0; index < warnings.size(); index++) {
                if (index > 0) {
                    appendComma(json);
                }
                appendString(json, warnings.get(index));
            }
            json.append(']');
        }

        private static void appendInvestments(StringBuilder json, List<Investment> investments) {
            json.append("\"investments\":[");
            for (int index = 0; index < investments.size(); index++) {
                if (index > 0) {
                    appendComma(json);
                }
                appendInvestment(json, investments.get(index));
            }
            json.append(']');
        }

        private static void appendInvestment(StringBuilder json, Investment investment) {
            json.append('{');
            appendStringField(json, "slug", investment.slug());
            appendComma(json);
            appendStringField(json, "type", investment.type());
            appendComma(json);
            appendStringField(json, "name", investment.name());
            appendComma(json);
            appendStringField(json, "symbol", investment.symbol());
            appendComma(json);
            appendNumberField(json, "quantity", investment.quantity());
            appendComma(json);
            appendNumberField(json, "investedAmount", investment.investedAmount());
            appendComma(json);
            appendNumberField(json, "currentValue", investment.currentValue());
            appendComma(json);
            appendNumberField(json, "gainLoss", investment.gainLoss());
            appendComma(json);
            appendNumberField(json, "returnPercent", investment.returnPercent());
            appendComma(json);
            appendStringField(json, "purchaseDate", investment.purchaseDate().toString());
            appendComma(json);
            appendStringField(json, "platform", investment.platform());
            appendComma(json);
            appendStringField(json, "riskLevel", investment.riskLevel());
            appendComma(json);
            appendStringField(json, "notes", investment.notes());
            appendComma(json);
            appendStringField(json, "lastUpdated", investment.lastUpdated().toString());
            json.append('}');
        }

        private static void appendStringField(StringBuilder json, String name, String value) {
            appendString(json, name);
            json.append(':');
            appendString(json, value);
        }

        private static void appendNumberField(StringBuilder json, String name, BigDecimal value) {
            appendString(json, name);
            json.append(':');
            json.append(number(value));
        }

        private static void appendString(StringBuilder json, String value) {
            json.append('"');
            String safeValue = value == null ? "" : value;
            for (int index = 0; index < safeValue.length(); index++) {
                char current = safeValue.charAt(index);
                switch (current) {
                    case '"' -> json.append("\\\"");
                    case '\\' -> json.append("\\\\");
                    case '\b' -> json.append("\\b");
                    case '\f' -> json.append("\\f");
                    case '\n' -> json.append("\\n");
                    case '\r' -> json.append("\\r");
                    case '\t' -> json.append("\\t");
                    default -> {
                        if (current < 0x20) {
                            json.append(String.format("\\u%04x", (int) current));
                        } else {
                            json.append(current);
                        }
                    }
                }
            }
            json.append('"');
        }

        private static void appendComma(StringBuilder json) {
            json.append(',');
        }

        private static String number(BigDecimal value) {
            BigDecimal safeValue = value == null ? BigDecimal.ZERO : value;
            return safeValue.setScale(Math.max(safeValue.scale(), 0), RoundingMode.HALF_UP)
                    .stripTrailingZeros()
                    .toPlainString();
        }
    }

    private record LoadedCsv(String csv, String source, List<String> warnings) {
        private LoadedCsv {
            csv = csv == null ? "" : csv;
            source = source == null || source.isBlank() ? "unknown" : source;
            warnings = List.copyOf(warnings == null ? List.of() : warnings);
        }
    }

    private record PortfolioSnapshot(
            List<Investment> investments,
            String source,
            List<String> warnings,
            Instant generatedAt
    ) {
        private PortfolioSnapshot {
            investments = List.copyOf(investments == null ? List.of() : investments);
            source = source == null || source.isBlank() ? "unknown" : source;
            warnings = List.copyOf(warnings == null ? List.of() : warnings);
            generatedAt = generatedAt == null ? Instant.now() : generatedAt;
        }

        BigDecimal totalInvested() {
            return investments.stream()
                    .map(Investment::investedAmount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
        }

        BigDecimal totalCurrentValue() {
            return investments.stream()
                    .map(Investment::currentValue)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
        }
    }

    private record Investment(
            String slug,
            String type,
            String name,
            String symbol,
            BigDecimal quantity,
            BigDecimal investedAmount,
            BigDecimal currentValue,
            LocalDate purchaseDate,
            String platform,
            String riskLevel,
            String notes,
            LocalDate lastUpdated
    ) {
        private Investment {
            slug = requireText(slug, "investment");
            type = requireText(type, "Other");
            name = requireText(name, "Unnamed investment");
            symbol = symbol == null ? "" : symbol;
            quantity = Objects.requireNonNullElse(quantity, BigDecimal.ZERO);
            investedAmount = Objects.requireNonNullElse(investedAmount, BigDecimal.ZERO);
            currentValue = Objects.requireNonNullElse(currentValue, BigDecimal.ZERO);
            purchaseDate = Objects.requireNonNullElse(purchaseDate, LocalDate.now());
            platform = requireText(platform, "Manual");
            riskLevel = requireText(riskLevel, "Medium");
            notes = notes == null ? "" : notes;
            lastUpdated = Objects.requireNonNullElse(lastUpdated, LocalDate.now());
        }

        BigDecimal gainLoss() {
            return currentValue.subtract(investedAmount);
        }

        BigDecimal returnPercent() {
            return percent(gainLoss(), investedAmount);
        }
    }

    private record CategorySummary(
            String type,
            BigDecimal investedAmount,
            BigDecimal currentValue,
            BigDecimal gainLoss,
            BigDecimal allocationPercent,
            BigDecimal returnPercent
    ) {
        static List<CategorySummary> from(List<Investment> investments) {
            Map<String, CategoryAccumulator> accumulators = new LinkedHashMap<>();
            for (Investment investment : investments) {
                accumulators.computeIfAbsent(investment.type(), CategoryAccumulator::new).add(investment);
            }

            BigDecimal totalCurrent = investments.stream()
                    .map(Investment::currentValue)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);

            return accumulators.values().stream()
                    .map(accumulator -> accumulator.toSummary(totalCurrent))
                    .sorted(Comparator.comparing(CategorySummary::currentValue).reversed())
                    .toList();
        }
    }

    private static final class CategoryAccumulator {
        private final String type;
        private BigDecimal investedAmount = BigDecimal.ZERO;
        private BigDecimal currentValue = BigDecimal.ZERO;

        private CategoryAccumulator(String type) {
            this.type = type;
        }

        private void add(Investment investment) {
            investedAmount = investedAmount.add(investment.investedAmount());
            currentValue = currentValue.add(investment.currentValue());
        }

        private CategorySummary toSummary(BigDecimal totalCurrent) {
            BigDecimal gainLoss = currentValue.subtract(investedAmount);
            return new CategorySummary(
                    type,
                    investedAmount,
                    currentValue,
                    gainLoss,
                    percent(currentValue, totalCurrent),
                    percent(gainLoss, investedAmount)
            );
        }
    }

    private static String requireText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static BigDecimal percent(BigDecimal numerator, BigDecimal denominator) {
        if (denominator == null || denominator.compareTo(BigDecimal.ZERO) == 0) {
            return BigDecimal.ZERO;
        }
        return numerator.multiply(BigDecimal.valueOf(100)).divide(denominator, 4, RoundingMode.HALF_UP);
    }
}
