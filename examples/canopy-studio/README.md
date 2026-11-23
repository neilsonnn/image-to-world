# Canopy Studio

An editable study of the supplied tiny-dome studio illustration. Ten independent modules build the plaster shell and round windows, limestone footing, woodland, house tree, trestle desk, swivel chair, typewriter, drawing papers, lamp and brush collection, and potted plants. The central window has an actual opening, recessed rails and layered trees beyond it. The drawing board, folio and shelf objects have depth and can be inspected from either camera.

Open a fresh editor project, configure `WLT_API_KEY` in **Workspace settings → Environment variables**, then pass the original illustration and the loopback URL to the recipe. Atlas estimates the input’s camera and depth before the recipe builds the studio.

```sh
bun run image-to-world open /path/to/new-project --port 4336
# In a second terminal
bun examples/canopy-studio/build.mjs /path/to/anime-room-2.png --url http://127.0.0.1:4336
```

Choose **Play** and drag either lamp by its shade. The base stays on the desk while the arms and shade pivot at their pins. The counterbalance holds the lamp where you leave it. Pick up the blue mug, the brush jar, the folio, the typewriter or a book from the stack and drop it onto the desk or flagstones. **Stop** restores the authored arrangement.

The recipe prints the Frame, hero camera and source asset IDs. Use **Reference** and **Set** in the hero view to compare the painting with the authored scene. The **Across the drafting table** camera is under **Inspection cameras**. Each procedural node carries its source, seed and editable parameters in Properties. All geometry and materials are local. The original illustration is bound to the Frame’s hidden image guide.
