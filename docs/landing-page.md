# Handoff landing page

Current public page: [Handoff](https://admired-fish-176.convex.site). The landing introduces adult children coordinating an aging parent's care and explains the connected record → reviewed action → visit → accepted responsibility journey. Actual Handoff desktop screenshots show fictional sample information; no caregiver testimonial, clinical result or adoption statistic is invented.

## Runtime and behavior

The existing native HTML/CSS/JavaScript app remains intact. `web/index.html` is the shared entry; `web/entry.js` selects the landing or workspace by the supported route. `web/app.js` handles public-page behavior. The sign-in and sample CTAs open real Convex-backed flows. The old in-memory landing demonstration was removed; historical screenshots of it are not current behavior.

Shared Inter/Source Serif 4 typography, common tokens, restrained sky/paper surfaces, native dialogs and reduced-motion behavior keep the public and authenticated surfaces consistent. Full-desktop references informed composition; responsive web fallback remains usable without adding a native app or PWA.

## Asset provenance

The release replaced the original reference-site decorative bitmaps and four paper masks with original Handoff SVG artwork: clouds, grain, notebook paper, dark paper and their masks. No copied reference-site image pixels or traced paths are included in these replacements. See [runtime asset provenance](../web/assets/ASSET-PROVENANCE.txt). Product screenshots were captured from Handoff with fictional data. Inter and Source Serif 4 retain their open-font notices in `web/assets/`.

Craft/Mobbin/reference captures and the older screenshot-recreation evidence remain local design research, excluded from public Git publication. Historical license warnings describe retired assets, not permission to redistribute them.

## Build and verification

`npm run build:web` creates `dist/` with the selected public Convex backend URL (`VITE_CONVEX_URL`, then process `CONVEX_URL`, then `.env.local`’s `CONVEX_URL`); `npm run preview:web` serves that exact built config. `npm run deploy` publishes through official Convex Static Hosting. The current deployment contains the original SVG replacements; post-deployment browser verification and exact scope are recorded in [release status](implementation-status.md). A local screenshot or build alone does not prove public behavior.
