---
name: TreeMind AI
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006591'
  on-secondary: '#ffffff'
  secondary-container: '#39b8fd'
  on-secondary-container: '#004666'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#0b1c30'
  on-tertiary-container: '#75859d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#c9e6ff'
  secondary-fixed-dim: '#89ceff'
  on-secondary-fixed: '#001e2f'
  on-secondary-fixed-variant: '#004c6e'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-xl:
    fontFamily: Public Sans
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Public Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Public Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Public Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Public Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Public Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Public Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-max: 1280px
  gutter: 24px
  margin-desktop: 40px
  margin-mobile: 16px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style
The design system focuses on "Intellectual Precision." It moves away from the saturated, consumer-grade aesthetics of current AI tools toward a professional, high-end environment that prioritizes cognitive clarity. The target audience includes researchers, analysts, and enterprise strategists who require a calm workspace for complex thought.

The design style is **Modern Minimalism**. It utilizes a sophisticated "Slate & Electric Blue" palette to establish a sense of technical authority. The interface relies on structural clarity, generous whitespace, and subtle micro-interactions rather than heavy ornamentation. Every element exists to support the hierarchy of information, ensuring that nested AI outputs remain legible and distinct.

## Colors
The palette is anchored by **Midnight Slate** (#0F172A) for primary typography and high-level structural elements, providing a grounded, authoritative feel. **Electric Blue** (#0EA5E9) is used sparingly as an action color to draw attention to AI-generated insights and primary calls to action.

**Surface Tiers:**
- **Base:** #F8FAFC (Neutral 50) - The primary canvas.
- **Surface:** #FFFFFF - Card containers and input fields.
- **Subtle:** #F1F5F9 (Neutral 100) - For secondary backgrounds and nested logic blocks.

A strict hierarchy of grays (Slate) ensures that information density doesn't lead to visual fatigue. Accents of Teal may be used for success states to maintain the cool, professional temperature of the UI.

## Typography
This design system utilizes **Public Sans** for its institutional clarity and rhythmic balance. It provides the "professional" weight required for an AI tool that handles data and logic. **Inter** is used for functional labels and technical metadata to ensure maximum legibility at small sizes.

**Hierarchy Rules:**
- **Headlines:** Use Slate 900 (#0F172A). Tighten letter-spacing on larger sizes to maintain a "high-end" editorial feel.
- **Body:** Use Slate 700 (#334155) for optimal long-form reading comfort.
- **Labels:** Use uppercase for `label-sm` to denote category headers or metadata tags.

## Layout & Spacing
The layout follows a **Fixed-Fluid Hybrid** model. While the central workspace for mind-mapping and tree structures is fluid, the sidebar and content containers conform to a strict 4px grid system.

**Breakpoints:**
- **Desktop (1280px+):** 12-column grid, 40px margins.
- **Tablet (768px - 1279px):** 8-column grid, 24px margins.
- **Mobile (< 767px):** 4-column grid, 16px margins.

Use "Stack" units for vertical rhythm: `stack-md` (16px) is the standard gap between related items, while `stack-lg` (32px) separates distinct content sections.

## Elevation & Depth
This design system employs **Low-Contrast Outlines** and **Tonal Layers** rather than heavy shadows. Depth is communicated through subtle shifts in background color and 1px borders.

- **Level 0 (Base):** Neutral 50 background.
- **Level 1 (Cards/Sidebar):** White background with a 1px Slate 200 border. No shadow.
- **Level 2 (Dropdowns/Modals):** White background with a 1px Slate 200 border and a very soft, diffused ambient shadow (0px 10px 15px -3px rgba(0, 0, 0, 0.05)).
- **Nesting:** Nested information (tree branches) uses vertical 2px "lineage borders" in Slate 200 to show parent-child relationships without adding visual bulk.

## Shapes
The shape language is **Soft**. It uses a 0.25rem (4px) base radius to maintain a professional, organized look. This avoids the "playfulness" of highly rounded corners while remaining more approachable than sharp 90-degree angles.

- **Primary Radius:** 4px (Buttons, Input fields).
- **Secondary Radius:** 8px (Cards, Modals).
- **Interactive States:** Use a subtle increase in border-weight or a change in border-color (Electric Blue) rather than a change in shape.

## Components
- **Buttons:** Primary buttons use a solid Midnight Slate background with white text. Secondary buttons use a white background with a 1px Slate 200 border. Ghost buttons are reserved for tertiary actions.
- **Input Fields:** Use 1px Slate 200 borders. On focus, the border transitions to Electric Blue with a subtle 2px glow.
- **Nodes/Chips:** For tree structures, use white backgrounds with Slate 200 borders. The active node should feature a 2px Electric Blue left-accent border.
- **Navigation:** Vertical sidebars should use Slate 50 as a background to distinguish them from the main White workspace.
- **Tree Connections:** Use thin (1px) Slate 300 paths. Avoid curved lines; use 45-degree or 90-degree angles for a technical, structured feel.