import {
  ArrowUUpLeft,
  Camera,
  CornersOut,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import {
  Flex,
  IconButton,
  Popover,
  Slider,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import type {
  Camera as CameraData,
  Projection,
  Workspace,
} from "../../../core/schema";
import type { Resolution } from "../../../core/formats";
import { useWorldbashClient } from "../lib/client";
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

export function ViewportCameraTools({
  camera,
  format,
  options,
  overrideName,
  onRelease,
}: {
  camera: CameraData;
  format: Resolution;
  options: Workspace["settings"]["viewportOptions"];
  overrideName?: string;
  onRelease: () => void;
}) {
  const { safeCommand, getWorkspace } = useWorldbashClient();
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
  const setFov = (fov: number) => {
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
  return (
    <div
      className="viewport-camera-bar floating-toolbar"
      role="toolbar"
      aria-label="Viewport camera settings"
    >
      <Hint
        label={
          overrideName
            ? `Camera settings overridden by ${overrideName}. Move or press Escape to restore the free viewport camera.`
            : "Independent viewport camera; used by Render"
        }
      >
        <span
          className={`viewport-camera-source${overrideName ? " overridden" : ""}`}
        >
          <Camera />
          <span>
            {overrideName ? `Overridden · ${overrideName}` : "Viewport"}
          </span>
        </span>
      </Hint>
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
      <Popover.Root>
        <Tooltip delayDuration={0} content="Lens and clipping settings">
          <Popover.Trigger>
            <IconButton
              size="1"
              variant="surface"
              color="gray"
              aria-label="Lens and clipping settings"
            >
              <SlidersHorizontal />
            </IconButton>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Content size="1" width="250px">
          <Flex direction="column" gap="2" className="viewport-camera-settings">
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
                max={
                  key === "near" ? Math.min(1000, options.far - 0.001) : 1000000
                }
                step={key === "near" ? 0.01 : 10}
                onCommit={(value) => updateOptions({ [key]: value })}
              />
            ))}
            <Text size="1" color="gray">
              Passepartout opacity · {Math.round(options.maskOpacity * 100)}%
            </Text>
            <Slider
              aria-label="Passepartout opacity"
              key={options.maskOpacity}
              defaultValue={[options.maskOpacity]}
              min={0}
              max={1}
              step={0.05}
              onValueCommit={([maskOpacity]) => updateOptions({ maskOpacity })}
            />
          </Flex>
        </Popover.Content>
      </Popover.Root>
      <Hint
        label={`Toggle passepartout · project render frame ${format.width} × ${format.height}`}
      >
        <IconButton
          size="1"
          variant={options.passepartout ? "soft" : "surface"}
          color="gray"
          aria-label="Toggle passepartout"
          aria-pressed={options.passepartout}
          onClick={() => updateOptions({ passepartout: !options.passepartout })}
        >
          <CornersOut />
        </IconButton>
      </Hint>
      <span className="viewport-camera-format">
        {format.width} × {format.height}
      </span>
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
    </div>
  );
}
