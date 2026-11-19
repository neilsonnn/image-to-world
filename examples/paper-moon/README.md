# Paper Moon attic

A local reference-view eval for the anime-room-3 illustration. The recipe builds 21 independently editable, textured GLBs and a procedural walnut case beneath one movable Frame. The illustration's annotated outlines, camera and depth estimates are authored for this specific image. Visible surfaces preserve the source painting. Hidden surfaces use inferred geometry and materials; large viewpoint changes expose the limits of reconstruction from one drawing.

Start a new empty project and run the build against it in a second terminal:

```sh
bun run image-to-world open /tmp/paper-moon-project --port 4342 --no-browser
bun examples/paper-moon/build.mjs /path/to/anime-room-3/source.png --url http://127.0.0.1:4342 --out /tmp/paper-moon-meshes
```

Pass the original PNG from the eval directory. The output directory must be new. The recipe uses the local editor CLI and runs without provider credentials. Use the image camera to compare the drawing and the assembled geometry. In the outline, translate and rotate the Frame to carry its contents. Every prop can be moved or exported independently. The showcase's separately generated Idol Max lamp can replace the procedural study's painted, extruded lamp through a guarded edit.
