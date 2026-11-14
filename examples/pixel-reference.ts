import { createCanvas } from "@napi-rs/canvas";
export function pixelReference() {
  const rows = [
    "................",
    "..bb......bb....",
    "..bpb....bpb....",
    "..bppbbbbppb....",
    "...bppppppb.....",
    "..bppppppppb....",
    "..bpwwppwwpb....",
    "..bpwkppkwpb....",
    "..bppppppppb....",
    "...bppkkppb.....",
    "....bppppb......",
    "...bggggggb.....",
    "..bgggllgggb....",
    "..bgggllgggb....",
    "...bbggggbb.....",
    "...bb....bb.....",
  ];
  const palette: Record<string, string> = {
    b: "#463b66",
    p: "#d2b8ed",
    w: "#fff1d6",
    k: "#352f46",
    g: "#7fae9e",
    l: "#e6cc7f",
  };
  const canvas = createCanvas(16, 16),
    context = canvas.getContext("2d");
  rows.forEach((row, y) =>
    [...row].forEach((color, x) => {
      if (palette[color]) {
        context.fillStyle = palette[color];
        context.fillRect(x, y, 1, 1);
      }
    }),
  );
  return canvas.toBuffer("image/png");
}
