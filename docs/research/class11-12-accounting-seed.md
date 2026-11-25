# Class 11–12 accounting seed research

- Official CDC curriculum catalogue: http://202.45.146.138/catalog/opac_css/index.php?lvl=cmspage&pageid=4&id_article=172
  - Lists Accounting as Acc. 103 for Grade 11 and Acc. 104 for Grade 12.
- Official CDC Accounting curriculum PDF: http://lib.moecdc.gov.np/elibrary/pages/download.php?ref=9694&size=&ext=pdf&k=&alternative=-1&iaccept=off&usage=-1&usagecomment=&email=
  - Grade 11 includes accounting concepts, journal/ledger, trial balance, bank reconciliation, fixed assets/depreciation, provisions/reserves, financial statements, double-entry and government accounting.
  - Grade 12 includes company accounting, financial statements, cash flow, cost accounting, inventory/material control, labour and overhead accounting, and accounting software.
- CDC Class 11 page: https://moecdc.gov.np/content/497/accounting-class-11/
- Practical hierarchical chart-of-accounts reference: https://www.dsj.org/wp-content/uploads/2018/06/Chart-of-Accounts-School_v2018-1.pdf
  - Demonstrates numbered Level 1/2/3 grouping, separate control categories for cash/bank, receivables, inventory, fixed assets, payables, deferred revenue, equity, revenue and expenses.

Implementation implication: keep Namo's five account types as the top-level classification, use account groups/subgroups for balance-sheet and income-statement families, keep existing stable GL codes/mappings, and make seeding idempotent per group/subgroup/ledger rather than only when a company has zero ledgers. Add practical ledgers for VAT, receivables/payables, advances, fixed assets, direct/indirect expenses and other income without changing existing product or term mappings.
