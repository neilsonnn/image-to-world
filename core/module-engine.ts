import * as THREE from "three";
import * as webgpu from "three/webgpu";
import * as tsl from "three/tsl";
import * as spark from "@sparkjsdev/spark";

/** Public engine namespaces shared by the compiler and both rendering contexts. */
export const moduleEngine = { THREE, webgpu, tsl, spark };
