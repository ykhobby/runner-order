# Design

A builder reads the app beside a cutting mat under a bright workbench lamp, so use a light surface with dark text and clearly bounded inputs.

- Restrained color strategy: warm neutral canvas, light content surfaces, dark green accent only for actions and selections.
- Native system sans for interface copy; system monospace for parts and runner codes.
- Desktop: two columns, an editable section list and a wider live cutting list. Mobile: stacked, full-width controls.
- Subtle full borders, modest corner radii, no decorative motion, and 44px minimum primary touch targets.
- OKLCH tokens in CSS, explicit hover, focus, selected, error, and disabled states.
- Named project controls sit below the project name; the saved-project picker stacks on mobile. Explicit Save, New project, and Open actions keep switching predictable.
- PDF mode and A4 page count use separate labelled radio groups. The default is one page; the fitting engine balances columns and preserves every individual part.
