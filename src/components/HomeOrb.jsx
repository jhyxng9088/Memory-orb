import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const MAX_NODES = 120
const MAX_EDGES = (MAX_NODES * (MAX_NODES - 1)) / 2

const REPULSION_STRENGTH = 0.5
const REPULSION_SOFTENING = 0.045
const MAX_REPULSION_FORCE = 6
const SPRING_STIFFNESS = 5.4
const SPRING_DAMPING = 0.95
const STRONG_REST_LENGTH = 0.42
const WEAK_REST_LENGTH = 1.58
const NODE_DAMPING = 2.6
const CENTER_OF_MASS_STIFFNESS = 0.22
const MAX_SPEED = 3.2
const SUBSTEPS = 3

function seededRandom(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function createMemoryProfile(index) {
  return {
    index,
    person: Math.floor(seededRandom(index * 37 + 11) * 5),
    place: Math.floor(seededRandom(index * 41 + 17) * 4),
    topic: Math.floor(seededRandom(index * 43 + 23) * 5),
  }
}

function getRelationshipStrength(profileA, profileB) {
  let strength = 0.03

  if (profileA.person === profileB.person) strength += 0.58
  if (profileA.place === profileB.place) strength += 0.18
  if (profileA.topic === profileB.topic) strength += 0.12

  const temporalDistance = Math.abs(profileA.index - profileB.index)
  strength += Math.exp(-temporalDistance / 6) * 0.08

  const lowIndex = Math.min(profileA.index, profileB.index)
  const highIndex = Math.max(profileA.index, profileB.index)
  strength += seededRandom((lowIndex + 1) * 97 + (highIndex + 1) * 53) * 0.04

  return THREE.MathUtils.clamp(strength, 0.03, 1)
}

function getRelationshipRestLength(strength, a, b) {
  const clustering = THREE.MathUtils.smoothstep(strength, 0.3, 0.84)
  const baseLength = THREE.MathUtils.lerp(
    WEAK_REST_LENGTH,
    STRONG_REST_LENGTH,
    clustering,
  )
  const variation = 0.96 + seededRandom((a + 1) * 29 + (b + 1) * 71) * 0.08

  return baseLength * variation
}

function getRelationshipStiffness(strength) {
  const shaped = THREE.MathUtils.smoothstep(strength, 0.14, 0.96)
  const influence = 0.0015 + Math.pow(shaped, 4.2) * 1.55
  return SPRING_STIFFNESS * influence
}

function getRelationshipDamping(strength) {
  const shaped = THREE.MathUtils.smoothstep(strength, 0.14, 0.96)
  const influence = 0.08 + Math.pow(shaped, 1.8) * 0.92
  return SPRING_DAMPING * influence
}

function getRelationshipBrightness(strength) {
  const shaped = THREE.MathUtils.smoothstep(strength, 0.08, 0.95)
  return 0.015 + Math.pow(shaped, 3.1) * 0.985
}

function createSpawnPosition(index) {
  if (index === 0) return new THREE.Vector3(0, 0, 0)

  const direction = new THREE.Vector3(
    seededRandom(index * 3 + 1) * 2 - 1,
    seededRandom(index * 3 + 2) * 2 - 1,
    seededRandom(index * 3 + 3) * 2 - 1,
  )

  if (direction.lengthSq() < 0.0001) direction.set(1, 0, 0)
  direction.normalize()

  const radius = 0.06 + seededRandom(index * 7 + 5) * 0.12
  return direction.multiplyScalar(radius)
}

function createLineBuffer() {
  return new Float32Array(MAX_EDGES * 2 * 3)
}

function createLineColorBuffer() {
  return new Float32Array(MAX_EDGES * 2 * 3)
}

function getRelativeDepth(node, center, cameraForward) {
  const x = node.position.x - center.x
  const y = node.position.y - center.y
  const z = node.position.z - center.z

  return x * cameraForward.x + y * cameraForward.y + z * cameraForward.z
}

function getFrontWeight(node, center, cameraForward, maxAbsDepth) {
  if (maxAbsDepth < 0.0001) return 0.5

  const depth = getRelativeDepth(node, center, cameraForward)
  return THREE.MathUtils.clamp(0.5 - depth / (maxAbsDepth * 2), 0, 1)
}

function applyNodeVisuals(
  mesh,
  nodes,
  dummy,
  color,
  center,
  cameraForward,
  maxAbsDepth,
) {
  if (!mesh) return

  mesh.count = nodes.length

  nodes.forEach((node, index) => {
    const frontWeight = getFrontWeight(
      node,
      center,
      cameraForward,
      maxAbsDepth,
    )
    const brightness = 0.9 + frontWeight * 0.1
    const scale = 0.96 + frontWeight * 0.06

    dummy.position.copy(node.position)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)

    color.setRGB(brightness, brightness, brightness)
    mesh.setColorAt(index, color)
  })

  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

const HomeOrb = forwardRef(function HomeOrb(_, ref) {
  const nodeRef = useRef()
  const lineGeometryRef = useRef()
  const nodesRef = useRef([])
  const edgesRef = useRef([])
  const [nodeCount, setNodeCount] = useState(0)

  const linePositions = useMemo(() => createLineBuffer(), [])
  const lineColors = useMemo(() => createLineColorBuffer(), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const nodeColor = useMemo(() => new THREE.Color(), [])
  const scratch = useMemo(
    () => ({
      delta: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      relativeVelocity: new THREE.Vector3(),
      centerOfMass: new THREE.Vector3(),
      centerCorrection: new THREE.Vector3(),
      cameraForward: new THREE.Vector3(),
    }),
    [],
  )

  useImperativeHandle(ref, () => ({
    addNode() {
      const nodes = nodesRef.current
      const edges = edgesRef.current
      const index = nodes.length

      if (index >= MAX_NODES) return false

      const position = createSpawnPosition(index)
      const outwardVelocity = position.clone()
      const profile = createMemoryProfile(index)

      if (outwardVelocity.lengthSq() > 0) {
        outwardVelocity.normalize().multiplyScalar(0.08)
      }

      nodes.push({
        position,
        velocity: outwardVelocity,
        force: new THREE.Vector3(),
        profile,
      })

      for (let candidateIndex = 0; candidateIndex < index; candidateIndex += 1) {
        const candidate = nodes[candidateIndex]
        const strength = getRelationshipStrength(profile, candidate.profile)

        edges.push({
          a: index,
          b: candidateIndex,
          strength,
          visualBrightness: getRelationshipBrightness(strength),
          restLength: getRelationshipRestLength(strength, index, candidateIndex),
          stiffness: getRelationshipStiffness(strength),
          damping: getRelationshipDamping(strength),
        })
      }

      setNodeCount(nodes.length)
      return true
    },
  }))

  useLayoutEffect(() => {
    if (nodeRef.current) {
      nodeRef.current.count = nodeCount
      nodeRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }

    if (lineGeometryRef.current) lineGeometryRef.current.setDrawRange(0, 0)
  }, [nodeCount])

  useFrame((state, frameDelta) => {
    const nodes = nodesRef.current
    const edges = edgesRef.current

    if (nodes.length === 0) return

    const dt = Math.min(frameDelta, 1 / 30)
    const step = dt / SUBSTEPS

    for (let substep = 0; substep < SUBSTEPS; substep += 1) {
      nodes.forEach((node) => node.force.set(0, 0, 0))

      scratch.centerOfMass.set(0, 0, 0)
      nodes.forEach((node) => scratch.centerOfMass.add(node.position))
      scratch.centerOfMass.multiplyScalar(1 / nodes.length)

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const nodeA = nodes[i]
          const nodeB = nodes[j]

          scratch.delta.copy(nodeA.position).sub(nodeB.position)
          const distanceSq = scratch.delta.lengthSq() + REPULSION_SOFTENING
          const distance = Math.sqrt(distanceSq)

          if (distance < 0.0001) continue

          scratch.direction.copy(scratch.delta).multiplyScalar(1 / distance)
          const forceMagnitude = Math.min(
            REPULSION_STRENGTH / distanceSq,
            MAX_REPULSION_FORCE,
          )

          nodeA.force.addScaledVector(scratch.direction, forceMagnitude)
          nodeB.force.addScaledVector(scratch.direction, -forceMagnitude)
        }
      }

      edges.forEach((edge) => {
        const nodeA = nodes[edge.a]
        const nodeB = nodes[edge.b]

        if (!nodeA || !nodeB) return

        scratch.delta.copy(nodeB.position).sub(nodeA.position)
        const distance = Math.max(scratch.delta.length(), 0.0001)
        scratch.direction.copy(scratch.delta).multiplyScalar(1 / distance)

        const stretch = distance - edge.restLength
        const relativeSpeed = scratch.relativeVelocity
          .copy(nodeB.velocity)
          .sub(nodeA.velocity)
          .dot(scratch.direction)

        const forceMagnitude =
          edge.stiffness * stretch + edge.damping * relativeSpeed

        nodeA.force.addScaledVector(scratch.direction, forceMagnitude)
        nodeB.force.addScaledVector(scratch.direction, -forceMagnitude)
      })

      scratch.centerCorrection
        .copy(scratch.centerOfMass)
        .multiplyScalar(-CENTER_OF_MASS_STIFFNESS)

      const damping = Math.exp(-NODE_DAMPING * step)

      nodes.forEach((node) => {
        node.force.add(scratch.centerCorrection)
        node.velocity.addScaledVector(node.force, step)
        node.velocity.multiplyScalar(damping)

        const speed = node.velocity.length()
        if (speed > MAX_SPEED) node.velocity.multiplyScalar(MAX_SPEED / speed)

        node.position.addScaledVector(node.velocity, step)
      })
    }

    scratch.centerOfMass.set(0, 0, 0)
    nodes.forEach((node) => scratch.centerOfMass.add(node.position))
    scratch.centerOfMass.multiplyScalar(1 / nodes.length)

    state.camera.getWorldDirection(scratch.cameraForward).normalize()

    let maxAbsDepth = 0
    nodes.forEach((node) => {
      maxAbsDepth = Math.max(
        maxAbsDepth,
        Math.abs(
          getRelativeDepth(node, scratch.centerOfMass, scratch.cameraForward),
        ),
      )
    })

    applyNodeVisuals(
      nodeRef.current,
      nodes,
      dummy,
      nodeColor,
      scratch.centerOfMass,
      scratch.cameraForward,
      maxAbsDepth,
    )

    if (lineGeometryRef.current) {
      const positionAttribute = lineGeometryRef.current.attributes.position
      const colorAttribute = lineGeometryRef.current.attributes.color
      const positionArray = positionAttribute.array
      const colorArray = colorAttribute.array

      edges.forEach((edge, edgeIndex) => {
        const nodeA = nodes[edge.a]
        const nodeB = nodes[edge.b]
        const offset = edgeIndex * 6

        positionArray[offset] = nodeA.position.x
        positionArray[offset + 1] = nodeA.position.y
        positionArray[offset + 2] = nodeA.position.z
        positionArray[offset + 3] = nodeB.position.x
        positionArray[offset + 4] = nodeB.position.y
        positionArray[offset + 5] = nodeB.position.z

        const frontA = getFrontWeight(
          nodeA,
          scratch.centerOfMass,
          scratch.cameraForward,
          maxAbsDepth,
        )
        const frontB = getFrontWeight(
          nodeB,
          scratch.centerOfMass,
          scratch.cameraForward,
          maxAbsDepth,
        )
        const depthA = 0.88 + frontA * 0.12
        const depthB = 0.88 + frontB * 0.12
        const brightnessA = edge.visualBrightness * depthA
        const brightnessB = edge.visualBrightness * depthB

        colorArray[offset] = 0.91 * brightnessA
        colorArray[offset + 1] = 0.93 * brightnessA
        colorArray[offset + 2] = 0.97 * brightnessA
        colorArray[offset + 3] = 0.91 * brightnessB
        colorArray[offset + 4] = 0.93 * brightnessB
        colorArray[offset + 5] = 0.97 * brightnessB
      })

      positionAttribute.needsUpdate = true
      colorAttribute.needsUpdate = true
      lineGeometryRef.current.setDrawRange(0, edges.length * 2)
    }
  })

  return (
    <group>
      <lineSegments>
        <bufferGeometry ref={lineGeometryRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[linePositions, 3]}
            usage={THREE.DynamicDrawUsage}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[lineColors, 3]}
            usage={THREE.DynamicDrawUsage}
          />
        </bufferGeometry>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.3}
          depthWrite={false}
          blending={THREE.NormalBlending}
          toneMapped={false}
        />
      </lineSegments>

      <instancedMesh
        ref={nodeRef}
        args={[null, null, MAX_NODES]}
        count={nodeCount}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.04, 14, 14]} />
        <meshBasicMaterial color="#f8f9fb" toneMapped={false} />
      </instancedMesh>
    </group>
  )
})

export default HomeOrb
