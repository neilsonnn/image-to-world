# Moonlit Workshop

A spatial study of the supplied anime-room-3 illustration, built from six editable Three.js modules. The scene uses a sloped sleeping alcove, folding shoji, sewn bedding, a writing desk, a turned stool and a small herbarium. The reference image is retained for the editor’s comparison view. All visible surfaces, geometry, material coordinates and lights are authored in code.

## Open the study

Start the editor with a new empty project. From this repository, run the following commands, substituting your reference file and the localhost address printed by the editor.

```sh
bun run image-to-world open /path/to/empty-workshop
bun examples/moonlit-workshop/build.mjs /path/to/anime-room-3.png --url http://127.0.0.1:4334
bun run image-to-world render workshop-frame --set --wait --url http://127.0.0.1:4334
bun run image-to-world render workshop-reading-nook --wait --url http://127.0.0.1:4334
```

The two cameras show the arrangement from the doorway and from beside the bed. The original illustration is available through **Reference**. With the source pixels hidden, the world still renders in full from either camera. The reference Frame has an empty, hidden Points node for optional future reconstruction.

## Change the room

Open a module in Properties to change its parameters. The room exposes wood grain and window-light intensities. The bed exposes fold strength and two cloth colors. The desk exposes enamel color and lamp intensity. The stool height and the herbarium’s grass count are editable. Each module carries its defaults and can be added independently with `module add`.

The shared craft code batches static parts by material and preserves their per-piece coordinates for the TSL woodgrain and woven fabric. The main spotlight uses a procedural shoji transmission pattern that crosses several objects in three dimensions. The six sources and their local dependencies are retained in the project. Running the recipe and rendering these views requires no provider keys.
