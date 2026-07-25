# Personal Portfolio

Personal Portfolio is a zero-cost Java 26 website for tracking investments from one dashboard. It uses only the JDK and static HTML/CSS/JS, so there are no paid APIs, package registries, SaaS dashboards, or external JavaScript libraries required.

## Run Locally

Prerequisite:

- JDK 26 installed and available through `JAVA_HOME`

Start the website:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1
```

Open:

```text
http://localhost:8080
```

Use another port:

```powershell
$env:PORT="9090"
powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1
```

## Build

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
java -jar .\build\personal-portfolio.jar
```

## Manual Investment Pages

The current UI is manual-entry first:

- `Dashboard` is the home page.
- `Mutual Funds` is page two.
- `Bonds` is page three.

The Mutual Funds page starts empty. Use `Add Mutual Fund` to add only the funds you want to track. Click a fund name to expand it.

Inside each fund:

- `+ SIP` adds a light-blue SIP row.
- `+ Lumpsum` adds a light-yellow lumpsum row.
- `Remove` deletes a row or a fund.

Each row has these columns:

```text
Year
NAV Date
Amount
Remove
```

The amount column has a total row below the table.

Values are saved in browser local storage so they survive refreshes in the same browser on the same machine. The Mutual Funds page also has `Export Backup` and `Import Backup` buttons. Use those JSON files for free storage outside local storage and for moving data between browsers.

## GitHub Pages

The frontend uses hash routes such as `#/mutual-funds`, relative assets, and JSON backup/import, so the static files can work on GitHub Pages. A GitHub Pages site cannot safely write investment data back into the repository by itself without exposing a secret token. For that reason, the free static workflow is:

1. Enter data in the website.
2. Use `Export Backup`.
3. Keep the downloaded JSON file privately.
4. Use `Import Backup` when opening the site from another browser or device.

## Production Notes

This app is a normal Java HTTP process. For production, run the built jar behind any free or self-hosted reverse proxy that supports Java 26 and a web port.

Minimum production checklist:

- Set `PORT` to the port required by your host.
- Put HTTPS in front of the app using the hosting provider or reverse proxy.
- Keep the app process running with the host's process manager.
- Browser local storage is per browser/device. For multi-device production use, add a small server-side save API or a private database.

GitHub Pages alone cannot run this Java backend. If you need a fully static deployment later, the frontend can be adjusted to read a CSV file directly, but that removes the Java server requirement.
