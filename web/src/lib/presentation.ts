import {
  ACESFilmicToneMapping,
  NoToneMapping,
  Color,
  EquirectangularReflectionMapping,
  PMREMGenerator,
  TextureLoader,
  Vector2,
  WebGLRenderTarget,
  HalfFloatType,
  PCFShadowMap,
  SRGBColorSpace,
  type Scene,
  type Camera,
  type WebGLRenderer,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { ArtDirection } from "../../../core/creation";
import { assetUrl, type Asset } from "../../../core/schema";

export class PresentationPipeline {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private lens: ShaderPass;
  private pmrem: PMREMGenerator;
  private environment?: Texture;
  private envKey = "";
  private generation = 0;
  private width = 0;
  private height = 0;
  constructor(
    private renderer: WebGLRenderer,
    private scene: Scene,
    camera: Camera,
  ) {
    this.pmrem = new PMREMGenerator(renderer);
    this.composer = new EffectComposer(
      renderer,
      new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 }),
    );
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new Vector2(1, 1), 0, 0.4, 1);
    this.composer.addPass(this.bloom);
    this.lens = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new Vector2(1, 1) },
        pixelSize: { value: 1 },
        distortion: { value: 0 },
        vignette: { value: 0 },
      },
      vertexShader:
        "varying vec2 vUv; void main() { vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float pixelSize; uniform float distortion; uniform float vignette; varying vec2 vUv;
        void main() { vec2 p=vUv*2.-1.; vec2 uv=(p*(1.+distortion*dot(p,p)*.35)+1.)*.5;
          if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.)))) { gl_FragColor=vec4(0.,0.,0.,1.); return; }
          if(pixelSize>1.) { vec2 grid=max(vec2(1.),floor(resolution/pixelSize)); uv=(floor(uv*grid)+.5)/grid; }
          vec4 c=texture2D(tDiffuse,uv); c.rgb*=1.-vignette*smoothstep(.2,1.5,dot(p,p)); gl_FragColor=c; }`,
    });
    this.composer.addPass(this.lens);
    this.composer.addPass(new OutputPass());
  }
  async configure(art: ArtDirection, assets: Record<string, Asset>) {
    this.renderer.toneMapping =
      art.preset === "pixel" ? NoToneMapping : ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = art.exposure;
    this.renderer.shadowMap.enabled = art.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;
    for (const target of [
      this.composer.renderTarget1,
      this.composer.renderTarget2,
    ]) {
      const samples = art.preset === "pixel" ? 0 : 4;
      if (target.samples !== samples) {
        target.samples = samples;
        target.dispose();
      }
    }
    this.scene.background = new Color(art.background);
    this.scene.environmentIntensity = art.environmentIntensity;
    this.bloom.enabled = art.bloom > 0;
    this.bloom.strength = art.bloom;
    this.bloom.threshold = art.bloomThreshold;
    this.lens.uniforms.pixelSize.value = art.pixelSize;
    this.lens.uniforms.distortion.value = art.lensDistortion;
    this.lens.uniforms.vignette.value = art.vignette;
    const asset = art.environmentAssetId
      ? assets[art.environmentAssetId]
      : undefined;
    const key = `${art.environment}:${asset?.id}:${asset?.modifiedAt}`;
    if (key === this.envKey) return;
    this.envKey = key;
    const generation = ++this.generation;
    let texture: Texture | undefined;
    if (art.environment === "studio") {
      const room = new RoomEnvironment();
      texture = this.pmrem.fromScene(room, 0.04).texture;
      room.dispose();
    } else if (art.environment === "asset") {
      if (!asset || asset.missing)
        throw new Error("Choose an available environment map asset");
      const source = /\.hdr$/i.test(asset.name)
        ? await new RGBELoader().loadAsync(assetUrl(asset))
        : await new TextureLoader().loadAsync(assetUrl(asset));
      if (generation !== this.generation) {
        source.dispose();
        return;
      }
      if (!/\.hdr$/i.test(asset.name)) source.colorSpace = SRGBColorSpace;
      source.mapping = EquirectangularReflectionMapping;
      texture = this.pmrem.fromEquirectangular(source).texture;
      source.dispose();
    }
    if (generation !== this.generation) {
      texture?.dispose();
      return;
    }
    this.environment?.dispose();
    this.environment = texture;
    this.scene.environment = texture ?? null;
  }
  render(width: number, height: number) {
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.composer.setSize(width, height);
      this.lens.uniforms.resolution.value.set(width, height);
    }
    this.composer.render();
  }
  dispose() {
    ++this.generation;
    this.environment?.dispose();
    this.pmrem.dispose();
    this.bloom.dispose();
    this.lens.dispose();
    this.composer.dispose();
  }
}
