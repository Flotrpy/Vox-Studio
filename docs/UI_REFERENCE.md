# UI Reference

Vox Studio's editor follows the layout conventions of desktop game editors:
menu bar, tool row, Hierarchy left, Scene/Game center, Inspector right at
full height, Project/Console below. This page records the target metrics
and how they are checked.

## Why there are no third-party screenshots in the repository

Screenshots of other editors are copyrighted and include their trademarks
and icons, so they are not stored here and the tests do not compare
against them. Instead, the reference arrangement is written down as numbers
(below) and enforced by `e2e/layout.spec.js`, and the look of Vox Studio
itself is pinned by screenshot baselines in `e2e/visual.spec.js-snapshots/`.
If you compare against another editor locally, keep those images out of
the repository.

## Target metrics

| Element                          | Size                        |
| -------------------------------- | --------------------------- |
| Menu bar                         | 22 px                       |
| Main toolbar                     | 32 px, tool buttons 22 px   |
| Status bar                       | 20 px                       |
| Dock tab strip                   | 20 px                       |
| Panel toolbars                   | 21 px                       |
| Tree rows (Hierarchy, Project)   | 18 px                       |
| Inspector field rows             | 18-20 px, inputs 18 px      |
| Component header                 | 22 px                       |
| Inspector width (default layout) | 17-27 % of the window       |
| Hierarchy width                  | 12-22 % of the window       |
| Project/Console height           | 25-40 % of the dock area    |
| Font                             | System UI, 12 px (11 px small) |
| Corners / borders                | 0-2 px radius, 1 px borders |

On touch screens (`pointer: coarse`) rows, fields and tool buttons grow
for finger input; the metric tests run with a mouse pointer.

## Running the checks

```
npm run test:e2e      # functional tests and layout metrics (CI)
npm run test:visual   # screenshot comparison against the baselines
npx playwright test --project=visual -u   # refresh baselines after an intended UI change
```

Screenshot baselines depend on the platform's fonts and are recorded on
Linux. Viewports are masked because software WebGL output varies between
machines.
