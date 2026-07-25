# Portfolio Data Folder

The current UI uses manual entry and browser local storage. This folder is not required for the Dashboard, Mutual Funds, or Bonds pages.

The Java API still supports this optional legacy CSV file:

```text
data/investments.csv
```

That file is ignored by git. If you use it later, keep the same columns as the bundled sample data:

```text
Type,Name,Symbol,Quantity,InvestedAmount,CurrentValue,PurchaseDate,Platform,RiskLevel,Notes,LastUpdated
```
