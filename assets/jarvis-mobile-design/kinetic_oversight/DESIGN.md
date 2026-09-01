---
name: Kinetic Oversight
colors:
  surface: '#10141a'
  surface-dim: '#10141a'
  surface-bright: '#353940'
  surface-container-lowest: '#0a0e14'
  surface-container-low: '#181c22'
  surface-container: '#1c2026'
  surface-container-high: '#262a31'
  surface-container-highest: '#31353c'
  on-surface: '#dfe2eb'
  on-surface-variant: '#bac9cc'
  inverse-surface: '#dfe2eb'
  inverse-on-surface: '#2d3137'
  outline: '#849396'
  outline-variant: '#3b494c'
  surface-tint: '#00daf3'
  primary: '#c3f5ff'
  on-primary: '#00363d'
  primary-container: '#00e5ff'
  on-primary-container: '#00626e'
  inverse-primary: '#006875'
  secondary: '#8dcdff'
  on-secondary: '#00344f'
  secondary-container: '#00affe'
  on-secondary-container: '#003f5f'
  tertiary: '#f2e9ff'
  on-tertiary: '#3c0090'
  tertiary-container: '#d9c8ff'
  on-tertiary-container: '#6c00f7'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#9cf0ff'
  primary-fixed-dim: '#00daf3'
  on-primary-fixed: '#001f24'
  on-primary-fixed-variant: '#004f58'
  secondary-fixed: '#cae6ff'
  secondary-fixed-dim: '#8dcdff'
  on-secondary-fixed: '#001e30'
  on-secondary-fixed-variant: '#004b70'
  tertiary-fixed: '#e9ddff'
  tertiary-fixed-dim: '#d1bcff'
  on-tertiary-fixed: '#23005b'
  on-tertiary-fixed-variant: '#5700c9'
  background: '#10141a'
  on-background: '#dfe2eb'
  surface-variant: '#31353c'
typography:
  headline-lg:
    fontFamily: Sora
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Sora
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: 0.01em
  headline-sm:
    fontFamily: Sora
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  data-display:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.1em
  headline-lg-mobile:
    fontFamily: Sora
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
spacing:
  unit: 4px
  gutter: 16px
  margin-mobile: 20px
  margin-desktop: 40px
  panel-padding: 12px
---

## Brand & Style

The design system is a futuristic, high-fidelity interface inspired by tactical holographic displays. It targets power users who require real-time data visualization and a sense of advanced technological agency. The brand personality is intelligent, precise, and vigilant.

The visual style is a hybrid of **Glassmorphism** and **Brutalism**. It utilizes translucent, frosted panels to simulate depth within a digital void, combined with the raw, structural integrity of geometric borders and monospaced data readouts. The emotional response is one of "calculated control"—the user should feel like they are operating a sophisticated piece of hardware rather than just a software application.

## Colors

The palette is anchored in a "Deep Space" black (`#000000` to `#0A0E14`) to provide maximum contrast for glowing elements. 

- **Primary (Electric Cyan):** Used for active states, primary data points, and critical HUD elements. It carries a subtle outer glow (bloom) to simulate light emission.
- **Secondary (Cyber Blue):** Used for supporting UI elements, secondary navigation, and decorative geometric accents.
- **Tertiary (Ion Purple):** Reserved for rare status alerts or specialized data streams to provide visual variety without breaking the monochromatic tech feel.
- **Surface Tints:** All "glass" panels use a semi-transparent version of the primary color at 5-10% opacity with a heavy background blur (20px-40px).

## Typography

This design system utilizes a dual-font strategy. **Sora** provides a futuristic, wide-aperture sans-serif look for headings, ensuring readability and a modern aesthetic. **JetBrains Mono** is the workhorse for all data, labels, and technical readouts, providing the "coded" look essential to the holographic narrative.

For mobile optimization, maintain a minimum touch target font size of 14px for interactive body text. Data-heavy tables may drop to 12px but must maintain high contrast against the dark background.

## Layout & Spacing

The layout follows a **Fluid Grid** model based on a 4px baseline. On mobile, a 4-column system is used, expanding to 12 columns on desktop. 

Spacing is intentionally tight to mimic high-density information displays (HUDs), but interactive elements must maintain a 48px minimum touch area. Use "fencing" (thin 1px borders) instead of wide margins to separate content areas. This maintains the "packed" technical aesthetic while providing clear structural boundaries.

## Elevation & Depth

Depth is conveyed through **Backdrop Blurs** and **Luminous Outlines** rather than traditional shadows.

1.  **Z-0 (The Void):** Pure black or very dark navy background.
2.  **Z-1 (HUD Layer):** Static UI elements, grid lines, and decorative scanning effects.
3.  **Z-2 (Glass Panels):** Semi-transparent containers (`alpha 0.08`) with 30px background blur and a 1px solid border (`alpha 0.2`).
4.  **Z-3 (Active Modals):** High-opacity glass with a primary color "glow" border and an outer neon bloom.

Scanning lines (horizontal 1px lines at 5% opacity) should scroll slowly across Z-1 to add "live" kinetic energy to the interface.

## Shapes

The shape language is strictly **Geometric and Sharp**. Circular HUD elements (gauges, progress rings) provide contrast against a predominantly rectangular grid. 

Corner treatments should be sharp (0px) to reinforce the industrial, hardware-like feel. In instances where "softness" is required for ergonomics (e.g., specific mobile buttons), use a maximum 2px radius or a 45-degree "snipped" corner (chamfer) rather than a curve.

## Components

- **Buttons:** Rectangular with 1px primary-colored borders. Filled buttons use a subtle gradient of Primary to Secondary. "Glow" effects trigger on hover or press.
- **HUD Gauges:** Circular SVG components showing percentages. Use segmented strokes (dashes) rather than solid lines to represent data increments.
- **Input Fields:** Bottom-border only, with a technical label (`label-caps`) positioned above the line. Active states trigger a vertical scanning line cursor.
- **Chips/Tags:** "Brackets" style (e.g., `[ DATA_01 ]`) using monospaced type and no background fill unless selected.
- **Cards:** Defined by 1px borders with "corner brackets" (L-shaped accents at the corners) to emphasize the holographic projection aesthetic.
- **Scanning Bar:** A constant, slow-moving horizontal light bar that passes over data lists, simulating a real-time system refresh.