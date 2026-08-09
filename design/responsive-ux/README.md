# Responsive workspace design

The generated reference in `work-board-viewports.png` compares the same Work board at 390, 1024, 1366, and 1600 pixels. It is a direction-setting artifact, not a literal implementation spec.

The implemented layout follows these rules:

- Below 768px, navigation moves to the bottom action dock and the Work board shows one selected lifecycle column.
- From 768px through 1535px, the desktop sidebar starts as an icon rail so boards retain useful card width. Users can still expand it manually.
- The Work board uses its actual content width, not the browser width: one column below 672px, two columns from 672px, and five columns from 1056px.
- At 1536px and wider, the full sidebar starts expanded while the five-column board remains readable.
- Dense extension boards share the wide page frame, avoid nested page padding, and keep horizontal scrolling local to Kanban or editable-grid regions.
- Mobile headers prioritize the page title and primary action; supporting copy returns when the viewport has room.

The reference was generated with the built-in image generation tool using the existing dark VertexADE visual language and the real board information hierarchy.
