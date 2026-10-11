# Formula Engine Decision Record

## Context

The backend requires live recalculation of the "4 Jane St" Excel template formulas synchronously over an API request whenever an estimator edits a cell value. The Excel template relies heavily on complex formulas including:
- Up to 8-way nested `IF(AND(...))` logic
- Bidirectional cross-sheet references across 5+ sheets
- `SUM()` over ranges
- Literal string-typed error sentinel return values (e.g., returning `"0"` or `"No Railings"` as strings)
- Implicitly position-linked repeating structures rather than uniform templating

We are evaluating two options for this capability:
1. **HyperFormula** (an open-source headless spreadsheet engine)
2. **Hand-rolled Custom Evaluator / DSL**

## Comparison

### Correctness
- **HyperFormula**: Replicates exact Excel behaviors out-of-the-box including `DIV/0!` errors, string vs numeric types, nested `IF`s, and cross-sheet relationships. Supports incremental recalculation natively.
- **Custom DSL**: Requires manual implementation of an abstract syntax tree (AST) parser, cyclic dependency graph detection, topological sort for partial recalculation, and porting hundreds of edge cases in Excel's type coercion behavior. A hand-rolled implementation is highly susceptible to subtle bugs (e.g. failing to properly cascade `Sub Total → Overhead → Profit` markups).

### Engineering Effort
- **HyperFormula**: Very low effort to integrate. It accepts raw 2D arrays generated directly from the Python/JS openpyxl/exceljs template extraction step. No parsing of individual formulas required.
- **Custom DSL**: High effort. Given the heterogeneous formula landscape explicitly defined in the template (e.g. some rows summing across columns, some looking up reference values, some using global string sentinels), creating a generic configurable JSON format that successfully models all behaviors would require special casing almost every row. In essence, recreating a spreadsheet engine.

### Licensing & Cost
- **HyperFormula**: Dual-licensed as **GPLv3** or Paid Proprietary. Since we are a closed-source backend, integrating a GPLv3 dependency is a major business and legal decision.
- **Custom DSL**: Fully in-house, unencumbered intellectual property.

### Bundle Size & Performance
- **HyperFormula**: Adds moderate bundle size, but performance is state-of-the-art for dependency graph tracking.
- **Custom DSL**: Minimal bundle size but potentially slow evaluation speeds unless caching and partial DAG recalculations are heavily optimized.

### Maintenance Burden
- **HyperFormula**: Negligible. As the Excel template evolves (or new templates are used), we just re-run the script to extract the updated string formulas into HyperFormula.
- **Custom DSL**: Massive burden. Every time a new formula pattern is added to an Excel update, the custom evaluator would need to be updated to support the new AST or DSL definitions.

## Recommendation

**We strongly recommend using HyperFormula.** Building a robust, dependency-graph-aware spreadsheet engine that properly mimics Excel's heterogeneous features is a monumental task that distracts from the core product. HyperFormula solves this perfectly by allowing us to feed literal extracted formula strings from our template directly into a server-side engine.

> [!WARNING]
> **Licensing Caveat - Product Owner Sign-off Required**
> HyperFormula is dual-licensed under GPLv3. While running the engine purely server-side (SaaS model without distributing binaries) *typically* avoids triggering GPL's copyleft distribution obligations (unlike AGPLv3), this is a strict legal question. We need **explicit sign-off** from the Product Owner and legal counsel that pulling a GPLv3 dependency into the closed-source backend is acceptable, or alternatively, approval to purchase a commercial license from Handsontable.

Until sign-off is received, we will build the `FormulaEngineService` interface using HyperFormula to prove out the architecture, but we will not merge or release this code to production without explicit licensing clearance.
