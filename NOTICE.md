# Third-party notices

This project's source code is licensed under the [MIT License](LICENSE). The
following third-party material is bundled in the repository under its own terms.

## `WCup_2026_4.2.7_en.xlsx` — World Cup 2026 planner workbook

- **Author / copyright:** Hermann Baum
- **Source:** <https://hermann-baum.de/excel/WorldCup/de>

This Microsoft Excel workbook is the freely distributed "WM-Tippspiel /
World Cup" planner created and maintained by **Hermann Baum**. It is **not**
covered by this project's MIT license and remains the property of its author.

It is included here because the application is built around it:

- it is the file participants fill in and upload as their predictions;
- it is the **seed source** for the 72 group fixtures and the team → group map
  (`scripts/seed.ts`);
- it is the source for the generated knockout-bracket data
  (`scripts/extractBracket.ts` → `lib/bracketData.ts`);
- it is the **test fixture** the parser/bracket tests validate against
  (champion "Spain", fully simulated).

If you fork or redistribute this repository, please keep this attribution. If
you are the rights holder and would prefer the file not be redistributed here,
please open an issue and it will be removed (the app can instead ask each user
to download the workbook directly from the source above).
