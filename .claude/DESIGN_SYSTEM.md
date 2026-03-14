# Rubric App V.2 — Design System

> **See also**: [Master Design System](../../.claude/DESIGN_SYSTEM.md) — shared standards for all Rubric App projects and Google-integrated apps

## Color & Contrast

### Text on White/Light Backgrounds

**WCAG AA Compliance Required** — all body text must meet WCAG AA contrast ratios (4.5:1 for normal text, 3:1 for large text).

#### Never Use (Too Light)
- ❌ `text-gray-400` — only 5.3:1, use for intentionally disabled UI only (e.g., greyed-out buttons)
- ❌ `text-gray-500` — only 5.8:1, insufficient for body text
- ❌ `text-blue-400` — insufficient contrast on white
- ❌ `text-blue-500` — borderline (4.54:1), avoid for body text

#### Always Use (Sufficient Contrast)
- ✅ `text-gray-600` — 7.5:1 contrast (**body text, descriptions, secondary info**)
- ✅ `text-gray-700` — 9.6:1 contrast (**body text, labels, highlights**)
- ✅ `text-gray-800` — 12.6:1 contrast (**emphasis, important labels**)
- ✅ `text-gray-900` — 21:1 contrast (**headings, primary content, strong emphasis**)

### Brand Blue (`#0033a0`)
- **Active/Selected state** — tab underlines, active buttons
- **NOT for body text** — insufficient contrast (3.95:1)
- Always pair with darker text for readability

### Emphasis Text
- Use `font-bold` + `text-gray-900` for inline emphasis (e.g., "full rubric")
- **Never** use color alone to highlight text on white backgrounds

## Typography

### Heading Hierarchy
- **h1** (page titles) — `text-2xl font-black text-gray-900`
- **h2** (section headers) — `text-lg font-bold text-gray-900`
- **h3** (subsections) — `text-base font-bold text-gray-900`
- **labels** — `text-sm font-bold text-gray-900` or `text-gray-700`
- **body** — `text-sm text-gray-700`
- **small text** (captions, hints) — `text-xs text-gray-600`

## Components

### Tabs (Active State)
```
border-[#0033a0] text-[#0033a0]
```
Inactive tabs use `text-gray-600 hover:text-gray-900`

### Form Inputs
- Border: `border-gray-300`
- Focus: `focus:ring-2 focus:ring-blue-500 outline-none`
- Label: `text-sm font-bold text-gray-900`
- Placeholder: `text-gray-500` (disabled state is acceptable here)

### Buttons
- Primary: `bg-blue-600 text-white hover:bg-blue-700`
- Secondary: `bg-gray-100 text-gray-900 hover:bg-gray-200`
- Disabled: `bg-gray-300 text-gray-400`

### Icons
- **"Add to Drive" button**: Use official Google Material Symbols icon only
  - **Source**: `https://fonts.gstatic.com/s/i/materialicons/add_to_drive/v1/24px.svg`
  - **NEVER create custom versions** — always fetch the official icon from Google's CDN
  - **Filter for white**: Use `style={{ filter: 'brightness(0) invert(1)' }}` when icon needs to be white on colored backgrounds
  - **Color**: Match icon color to surrounding text color for visual consistency
- **All other icons**: Use lucide-react library (`CheckCircle2`, `Loader2`, `RotateCw`, `Clock`, `X`, etc.)
- **Icon colors**: Must meet same contrast rules as text — use `text-gray-700` or darker for body, `text-blue-600` for accent, `text-green-600` for success

### Error/Status Messages
- Error text: `text-red-700` (or `text-red-600` on white)
- Success: `text-green-700`
- Warning: `text-yellow-700`

## Checklist Before Commit

When adding new UI elements:
- [ ] All body text is `text-gray-600` or darker
- [ ] No `text-gray-400` or `text-gray-500` except for disabled states
- [ ] Inline emphasis uses `font-bold` + `text-gray-900`, not color
- [ ] Headings are `text-gray-900`
- [ ] Forms follow button/input patterns above
- [ ] Color contrast meets WCAG AA (4.5:1 minimum for normal text)
- [ ] Icon colors meet contrast requirements (use `text-gray-700` or darker for body content)
- [ ] "Add to Drive" button uses official Google Material Symbols icon from CDN (never custom versions)
- [ ] All lucide-react icons match the color scheme (no light colors like `text-gray-400`)

Run this contrast check: [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
