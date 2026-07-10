import * as THREE from 'three'

// Low-poly dieren uit gedeelde basisvormen; elk onderdeel is een mesh met
// eigen schaal/positie, zodat we ze per stuk kunnen animeren (poten, oren,
// vleugels) zonder keyframes of modelbestanden.

const box = new THREE.BoxGeometry(1, 1, 1)
const cone = new THREE.ConeGeometry(0.5, 1, 5)

const materials = new Map<number, THREE.MeshLambertMaterial>()

function mat(color: number): THREE.MeshLambertMaterial {
  let m = materials.get(color)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true })
    materials.set(color, m)
  }
  return m
}

function part(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  color: number,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, mat(color))
  mesh.position.set(x, y, z)
  mesh.scale.set(sx, sy, sz)
  mesh.castShadow = true
  parent.add(mesh)
  return mesh
}

/** Scharnier op heup/schouder: de mesh hangt eronder en zwaait mee. */
function limb(
  parent: THREE.Object3D,
  color: number,
  x: number,
  y: number,
  z: number,
  thickness: number,
  length: number
): THREE.Object3D {
  const pivot = new THREE.Group()
  pivot.position.set(x, y, z)
  part(pivot, box, color, 0, -length / 2, 0, thickness, length, thickness)
  parent.add(pivot)
  return pivot
}

export interface AnimalRig {
  root: THREE.Group
  body: THREE.Object3D
  head: THREE.Object3D
  legs: THREE.Object3D[]
  wings: THREE.Object3D[]
  /** Hoogte van het lijf boven de grond (voor plaatsing). */
  rideHeight: number
}

export function buildRabbit(): AnimalRig {
  const root = new THREE.Group()
  const fur = 0xb99a76
  const body = part(root, box, fur, 0, 0.22, 0, 0.26, 0.24, 0.42)
  const head = new THREE.Group()
  head.position.set(0, 0.34, 0.24)
  part(head, box, fur, 0, 0, 0, 0.18, 0.17, 0.19)
  part(head, box, 0xf5ecdd, 0, 0.19, -0.02, 0.045, 0.2, 0.03) // oor
  part(head, box, 0xf5ecdd, 0.06, 0.19, -0.02, 0.045, 0.2, 0.03)
  root.add(head)
  part(root, box, 0xffffff, 0, 0.24, -0.23, 0.1, 0.1, 0.1) // staartje
  const legs = [
    limb(root, fur, -0.09, 0.14, 0.16, 0.06, 0.14),
    limb(root, fur, 0.09, 0.14, 0.16, 0.06, 0.14),
    limb(root, fur, -0.09, 0.14, -0.16, 0.07, 0.14),
    limb(root, fur, 0.09, 0.14, -0.16, 0.07, 0.14)
  ]
  return { root, body, head, legs, wings: [], rideHeight: 0.0 }
}

export function buildDeer(): AnimalRig {
  const root = new THREE.Group()
  const fur = 0x9c7448
  const body = part(root, box, fur, 0, 0.92, 0, 0.42, 0.5, 1.0)
  const head = new THREE.Group()
  head.position.set(0, 1.28, 0.52)
  part(head, box, fur, 0, 0.1, 0.05, 0.2, 0.42, 0.22) // nek
  part(head, box, 0x8a653e, 0, 0.36, 0.16, 0.18, 0.18, 0.3) // kop
  part(head, cone, 0x6d5030, -0.09, 0.55, 0.06, 0.16, 0.35, 0.16) // gewei
  part(head, cone, 0x6d5030, 0.09, 0.55, 0.06, 0.16, 0.35, 0.16)
  root.add(head)
  part(root, box, 0xf5ecdd, 0, 1.0, -0.52, 0.12, 0.14, 0.08) // spiegel
  const legs = [
    limb(root, 0x8a653e, -0.14, 0.7, 0.36, 0.09, 0.7),
    limb(root, 0x8a653e, 0.14, 0.7, 0.36, 0.09, 0.7),
    limb(root, 0x8a653e, -0.14, 0.7, -0.36, 0.09, 0.7),
    limb(root, 0x8a653e, 0.14, 0.7, -0.36, 0.09, 0.7)
  ]
  return { root, body, head, legs, wings: [], rideHeight: 0.0 }
}

export function buildBird(color: number): AnimalRig {
  const root = new THREE.Group()
  const body = part(root, cone, color, 0, 0, 0, 0.22, 0.5, 0.22)
  body.rotation.x = Math.PI / 2 // neus naar voren
  part(root, cone, 0xffca55, 0, 0, 0.3, 0.07, 0.14, 0.07).rotation.x = Math.PI / 2 // snavel
  const wingL = new THREE.Group()
  wingL.position.set(-0.06, 0.02, 0)
  part(wingL, box, color, -0.2, 0, 0, 0.4, 0.03, 0.2)
  root.add(wingL)
  const wingR = new THREE.Group()
  wingR.position.set(0.06, 0.02, 0)
  part(wingR, box, color, 0.2, 0, 0, 0.4, 0.03, 0.2)
  root.add(wingR)
  return { root, body, head: body, legs: [], wings: [wingL, wingR], rideHeight: 0 }
}
