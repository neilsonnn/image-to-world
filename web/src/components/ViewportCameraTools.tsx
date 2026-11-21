import { Aperture, ArrowUUpLeft } from "@phosphor-icons/react";
import { Flex, IconButton, Text } from "@radix-ui/themes";
import type {
  Camera as CameraData,
  Projection,
  Workspace,
} from "../../../core/schema";
import type { Resolution } from "../../../core/formats";
import { useImageToWorldClient } from "../lib/client";
import { liveViewportCamera } from "../lib/viewport-camera";
import { NumericInput } from "./NumericInput";
import { Hint } from "./ui";

const degrees = (radians: number) => (radians * 180) / Math.PI;
const verticalFov = (p: Projection) =>
  degrees(2 * Math.atan(p.height / (2 * p.fy)));
const lensFields = {
  vertical: {
    label: "Vertical FOV",
    unit: "°",
    get: verticalFov,
    toVertical: (value: number, _p: Projection) => value,
    min: 10,
    max: 120,
    step: 1,
  },
  horizontal: {
    label: "Horizontal FOV",
    unit: "°",
    get: (p: Projection) => degrees(2 * Math.atan(p.width / (2 * p.fx))),
    toVertical: (value: number, p: Projection) =>
      degrees(
        2 * Math.atan((Math.tan((value * Math.PI) / 360) * p.height) / p.width),
      ),
    min: 1,
    max: 175,
    step: 1,
  },
  focal: {
    label: "Focal length",
    unit: "mm",
    get: (p: Projection) => (36 * p.fx) / p.width,
    toVertical: (value: number, p: Projection) =>
      degrees(2 * Math.atan((36 * p.height) / (2 * value * p.width))),
    min: 1,
    max: 1000,
    step: 0.5,
  },
} as const;

export function useSetViewportFov(
  camera: CameraData,
  format: Resolution,
  overrideName?: string,
) {
  const { safeCommand, getWorkspace } = useImageToWorldClient();
  return (fov: number) => {
    if (getWorkspace().settings.viewingCameraId || overrideName) return;
    const value = Math.max(10, Math.min(120, fov));
    const current = liveViewportCamera() ?? camera;
    const focal = format.height / (2 * Math.tan((value * Math.PI) / 360));
    void safeCommand({
      type: "workspace.update",
      settings: {
        viewportCamera: {
          ...current,
          intrinsics: {
            ...format,
            fx: focal,
            fy: focal,
            cx: format.width / 2,
            cy: format.height / 2,
          },
        },
      },
    });
  };
}

type LensProps = {
  camera: CameraData;
  overrideName?: string;
  setFov: (value: number) => void;
};

export function ViewportCameraTools({
  camera,
  overrideName,
  setFov,
  autoFov,
  onRelease,
}: LensProps & {
  autoFov: number | null;
  onRelease: () => void;
}) {
  return (
    <>
      <Hint label="Vertical field of view in degrees">
        <div className="viewport-fov">
          <NumericInput
            label="FOV"
            value={Number(verticalFov(camera.intrinsics).toFixed(1))}
            min={10}
            max={120}
            step={1}
            disabled={!!overrideName}
            onCommit={setFov}
          />
        </div>
      </Hint>
      <Hint
        label={
          autoFov === null
            ? "No spatial context camera FOVs available"
            : `Set vertical FOV to the spatial context average (${autoFov.toFixed(1)}°)`
        }
      >
        <IconButton
          aria-label="Match spatial context FOV"
          size="1"
          variant="surface"
          color="gray"
          disabled={!!overrideName || autoFov === null}
          onClick={() => {
            if (autoFov !== null) setFov(autoFov);
          }}
        >
          <Aperture />
        </IconButton>
      </Hint>
      {overrideName && (
        <Hint label="Restore viewport camera (Escape)">
          <IconButton
            size="1"
            variant="surface"
            color="gray"
            aria-label="Restore viewport camera"
            onClick={onRelease}
          >
            <ArrowUUpLeft />
          </IconButton>
        </Hint>
      )}
    </>
  );
}

export function ViewportLensSettings({
  camera,
  overrideName,
  setFov,
  options,
}: LensProps & {
  options: Workspace["settings"]["viewportOptions"];
}) {
  const { safeCommand, getWorkspace } = useImageToWorldClient();
  const updateOptions = (patch: Partial<typeof options>) =>
    void safeCommand({
      type: "workspace.update",
      settings: {
        viewportOptions: {
          ...getWorkspace().settings.viewportOptions,
          ...patch,
        },
      },
    });
  return (
    <Flex direction="column" gap="2" className="viewport-camera-settings">
      <Text size="1" weight="medium">
        Camera lens
      </Text>
      {overrideName && (
        <Text size="1" color="gray">
          Lens overridden by {overrideName}
        </Text>
      )}
      {Object.entries(lensFields).map(([key, field]) => (
        <Hint
          key={key}
          label={
            key === "focal"
              ? "Focal length using a 36 mm sensor width"
              : `${field.label}, measured across the project render frame`
          }
        >
          <div className="viewport-camera-field">
            <NumericInput
              label={field.label}
              value={Number(field.get(camera.intrinsics).toFixed(2))}
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={!!overrideName}
              onCommit={(value) =>
                setFov(field.toVertical(value, camera.intrinsics))
              }
            />
            <span>{field.unit}</span>
          </div>
        </Hint>
      ))}
      <Text size="1" color="gray">
        Clipping distance
      </Text>
      {(["near", "far"] as const).map((key) => (
        <NumericInput
          key={key}
          label={key === "near" ? "Near" : "Far"}
          value={options[key]}
          min={key === "near" ? 0.001 : Math.max(1, options.near + 0.001)}
          max={key === "near" ? Math.min(1000, options.far - 0.001) : 1000000}
          step={key === "near" ? 0.01 : 10}
          onCommit={(value) => updateOptions({ [key]: value })}
        />
      ))}
    </Flex>
  );
}
