import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const NODE_COUNT = 96
const RADIUS = 2.25

const EDGE_STIFFNESS = 16.5
const EDGE_DAMPING = 2.15
const ANCHOR_STIFFNESS = 1.35
const RADIAL_STIFFNESS = 3.1
const NODE_DAMPING = 2.55
const MOTION_FORCE = 3.05
const MAX_ANGULAR_SPEED = 3.8
const MAX_OFFSET = 0.46
const SUBSTEPS = 3

const NODE_SIZE_PX = 8
const INNER_GLOW_SIZE_PX = 19
const OUTER_GLOW_SIZE_PX = 38
const BACK_DEPTH_BRIGHTNESS = 0.9

function createSpherePoints() {
  return Array.from({ length: NODE_COUNT }, (_, index) => {
    const y = 1 - (index / (NODE_COUNT - 1)) * 2
    const radiusAtY = Math.sqrt(1 - y * y)
    const theta = Math.PI * (3 - Math.sqrt(5)) * index

    return new THREE.Vector3(
      Math.cos(theta) * radiusAtY * RADIUS,
      y * RADIUS,
      Math.sin(theta) * radiusAtY * RADIUS,
    )
  })
}

function createConnections(points) {
  const seen = new Set()
  const edges = []

  points.forEach((point, index) => {
    const nearest = points
      .map((candidate, candidateIndex) => ({
        candidateIndex,
        distance: point.distanceToSquared(candidate),
      }))
      .filter(({ candidateIndex }) => candidateIndex !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)

    nearest.forEach(({ candidateIndex }) => {
      const a = Math.min(index, candidateIndex)
      const b = Math.max(index, candidateIndex)
      const key = `${a}:${b}`

      if (seen.has(key)) return
      seen.add(key)

      edges.push({
        a,
        b,
        restLength: points[a].distanceTo(points[b]),
      })
    })
  })

  return edges
}

function createConnectionBuffer(points, edges) {
  const positions = new Float32Array(edges.length * 2 * 3)

  edges.forEach((edge, edgeIndex) => {
    const a = points[edge.a]
    const b = points[edge.b]
    const offset = edgeIndex * 6

    positions[offset] = a.x
    positions[offset + 1] = a.y
    positions[offset + 2] = a.z
    positions[offset + 3] = b.x
    positions[offset + 4] = b.y
    positions[offset + 5] = b.z
  })

  return positions
}

function createPointBuffer(points) {
  const positions = new Float32Array(points.length * 3)

  points.forEach((point, index) => {
    const offset = index * 3
    positions[offset] = point.x
    positions[offset + 1] = point.y
    positions[offset + 2] = point.z
  })

  return positions
}

function createColorBuffer(count) {
  const colors = new Float32Array(count * 3)
  colors.fill(1)
  return colors
}

function createGlowTexture() {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  const center = 64
  const gradient = context.createRadialGradient(center, center, 0, center, center, 62)

  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.06, 'rgba(247,250,255,0.98)')
  gradient.addColorStop(0.16, 'rgba(226,237,255,0.62)')
  gradient.addColorStop(0.34, 'rgba(205,224,255,0.24)')
  gradient.addColorStop(0.62, 'rgba(196,219,255,0.08)')
  gradient.addColorStop(1, 'rgba(196,219,255,0)')

  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function createNodeTexture() {
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')

  context.clearRect(0, 0, 128, 128)
  context.beginPath()
  context.arc(64, 64, 46, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

function writeBrightness(array, offset, brightness) {
  array[offset] = brightness
  array[offset + 1] = brightness
  array[offset + 2] = brightness
}

export default function HomeOrb() {
  const nodeGeometryRef = useRef()
  const innerGlowGeometryRef = useRef()
  const outerGlowGeometryRef = useRef()
  const lineGeometryRef = useRef()
  const previousCameraQuaternion = useRef(new THREE.Quaternion())
  const hasPreviousCameraQuaternion = useRef(false)

  const restPoints = useMemo(() => createSpherePoints(), [])
  const currentPoints = useMemo(
    () => restPoints.map((point) => point.clone()),
    [restPoints],
  )
  const velocities = useMemo(
    () => restPoints.map(() => new THREE.Vector3()),
    [restPoints],
  )
  const forces = useMemo(
    () => restPoints.map(() => new THREE.Vector3()),
    [restPoints],
  )
  const responseFactors = useMemo(
    () => restPoints.map((_, index) => 0.86 + 0.22 * (0.5 + 0.5 * Math.sin(index * 2.173))),
    [restPoints],
  )
  const depthFactors = useMemo(() => new Float32Array(NODE_COUNT).fill(1), [])
  const edges = useMemo(() => createConnections(restPoints), [restPoints])
  const connectionPositions = useMemo(
    () => createConnectionBuffer(restPoints, edges),
    [edges, restPoints],
  )
  const connectionColors = useMemo(
    () => createColorBuffer(edges.length * 2),
    [edges],
  )
  const nodePositions = useMemo(() => createPointBuffer(restPoints), [restPoints])
  const innerGlowPositions = useMemo(() => createPointBuffer(restPoints), [restPoints])
  const outerGlowPositions = useMemo(() => createPointBuffer(restPoints), [restPoints])
  const nodeColors = useMemo(() => createColorBuffer(NODE_COUNT), [])
  const innerGlowColors = useMemo(() => createColorBuffer(NODE_COUNT), [])
  const outerGlowColors = useMemo(() => createColorBuffer(NODE_COUNT), [])
  const nodeTexture = useMemo(() => createNodeTexture(), [])
  const glowTexture = useMemo(() => createGlowTexture(), [])

  const scratch = useMemo(
    () => ({
      deltaQuaternion: new THREE.Quaternion(),
      inversePrevious: new THREE.Quaternion(),
      angularAxis: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      cameraDirection: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      delta: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      anchorDelta: new THREE.Vector3(),
      radialDirection: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      projected: new THREE.Vector3(),
    }),
    [],
  )

  useEffect(() => {
    return () => {
      nodeTexture?.dispose()
      glowTexture?.dispose()
    }
  }, [glowTexture, nodeTexture])

  useFrame((state, frameDelta) => {
    const dt = Math.min(frameDelta, 1 / 30)
    const cameraQuaternion = state.camera.quaternion

    if (!hasPreviousCameraQuaternion.current) {
      previousCameraQuaternion.current.copy(cameraQuaternion)
      hasPreviousCameraQuaternion.current = true
    }

    scratch.inversePrevious.copy(previousCameraQuaternion.current).invert()
    scratch.deltaQuaternion.copy(cameraQuaternion).multiply(scratch.inversePrevious)

    if (scratch.deltaQuaternion.w < 0) {
      scratch.deltaQuaternion.set(
        -scratch.deltaQuaternion.x,
        -scratch.deltaQuaternion.y,
        -scratch.deltaQuaternion.z,
        -scratch.deltaQuaternion.w,
      )
    }

    const sinHalfAngle = Math.sqrt(
      scratch.deltaQuaternion.x * scratch.deltaQuaternion.x +
        scratch.deltaQuaternion.y * scratch.deltaQuaternion.y +
        scratch.deltaQuaternion.z * scratch.deltaQuaternion.z,
    )

    let angularSpeed = 0
    scratch.angularVelocity.set(0, 0, 0)

    if (sinHalfAngle > 0.000001 && dt > 0) {
      const angle = 2 * Math.atan2(
        sinHalfAngle,
        THREE.MathUtils.clamp(scratch.deltaQuaternion.w, -1, 1),
      )

      scratch.angularAxis.set(
        scratch.deltaQuaternion.x / sinHalfAngle,
        scratch.deltaQuaternion.y / sinHalfAngle,
        scratch.deltaQuaternion.z / sinHalfAngle,
      )

      angularSpeed = Math.min(angle / dt, MAX_ANGULAR_SPEED)
      scratch.angularVelocity.copy(scratch.angularAxis).multiplyScalar(angularSpeed)
    }

    previousCameraQuaternion.current.copy(cameraQuaternion)
    scratch.cameraDirection.copy(state.camera.position).normalize()

    const motionAmount = THREE.MathUtils.smoothstep(angularSpeed, 0.02, 0.8)
    const step = dt / SUBSTEPS

    for (let substep = 0; substep < SUBSTEPS; substep += 1) {
      forces.forEach((force) => force.set(0, 0, 0))

      currentPoints.forEach((point, index) => {
        const restPoint = restPoints[index]
        const response = responseFactors[index]

        scratch.anchorDelta.copy(restPoint).sub(point)
        forces[index].addScaledVector(
          scratch.anchorDelta,
          ANCHOR_STIFFNESS * response,
        )

        const radius = Math.max(point.length(), 0.0001)
        const radialError = radius - RADIUS
        scratch.radialDirection.copy(point).multiplyScalar(1 / radius)
        forces[index].addScaledVector(
          scratch.radialDirection,
          -radialError * RADIAL_STIFFNESS,
        )

        if (motionAmount > 0) {
          scratch.tangent.crossVectors(scratch.angularVelocity, point)

          const facing = THREE.MathUtils.clamp(
            point.dot(scratch.cameraDirection) / radius,
            -1,
            1,
          )
          const frontWeight = THREE.MathUtils.smoothstep(facing, -0.42, 0.74)

          scratch.projected.copy(point).project(state.camera)
          const dx = scratch.projected.x - state.pointer.x
          const dy = scratch.projected.y - state.pointer.y
          const pointerDistanceSq = dx * dx + dy * dy
          const pointerWeight = Math.exp(-pointerDistanceSq / 0.38)

          const contactWeight = frontWeight * (0.18 + 0.82 * pointerWeight)
          const irregularity = 0.82 + 0.34 * response

          forces[index].addScaledVector(
            scratch.tangent,
            -MOTION_FORCE * motionAmount * contactWeight * irregularity,
          )
        }
      })

      edges.forEach((edge) => {
        const pointA = currentPoints[edge.a]
        const pointB = currentPoints[edge.b]
        const velocityA = velocities[edge.a]
        const velocityB = velocities[edge.b]

        scratch.delta.copy(pointB).sub(pointA)
        const distance = Math.max(scratch.delta.length(), 0.0001)
        scratch.direction.copy(scratch.delta).multiplyScalar(1 / distance)

        const stretch = distance - edge.restLength
        const relativeSpeed = scratch.delta
          .copy(velocityB)
          .sub(velocityA)
          .dot(scratch.direction)

        const forceMagnitude = EDGE_STIFFNESS * stretch + EDGE_DAMPING * relativeSpeed

        forces[edge.a].addScaledVector(scratch.direction, forceMagnitude)
        forces[edge.b].addScaledVector(scratch.direction, -forceMagnitude)
      })

      const damping = Math.exp(-NODE_DAMPING * step)

      currentPoints.forEach((point, index) => {
        velocities[index].addScaledVector(forces[index], step)
        velocities[index].multiplyScalar(damping)
        point.addScaledVector(velocities[index], step)

        scratch.offset.copy(point).sub(restPoints[index])
        const offsetLength = scratch.offset.length()

        if (offsetLength > MAX_OFFSET) {
          scratch.offset.multiplyScalar(MAX_OFFSET / offsetLength)
          point.copy(restPoints[index]).add(scratch.offset)
          velocities[index].multiplyScalar(0.68)
        }
      })
    }

    const nodePositionAttribute = nodeGeometryRef.current?.attributes.position
    const innerGlowPositionAttribute = innerGlowGeometryRef.current?.attributes.position
    const outerGlowPositionAttribute = outerGlowGeometryRef.current?.attributes.position
    const nodeColorAttribute = nodeGeometryRef.current?.attributes.color
    const innerGlowColorAttribute = innerGlowGeometryRef.current?.attributes.color
    const outerGlowColorAttribute = outerGlowGeometryRef.current?.attributes.color

    currentPoints.forEach((point, index) => {
      const offset = index * 3
      const radius = Math.max(point.length(), 0.0001)
      const facing = THREE.MathUtils.clamp(
        point.dot(scratch.cameraDirection) / radius,
        -1,
        1,
      )
      const facing01 = facing * 0.5 + 0.5
      const depthBrightness =
        BACK_DEPTH_BRIGHTNESS + (1 - BACK_DEPTH_BRIGHTNESS) * facing01

      depthFactors[index] = depthBrightness

      if (nodePositionAttribute) {
        nodePositionAttribute.array[offset] = point.x
        nodePositionAttribute.array[offset + 1] = point.y
        nodePositionAttribute.array[offset + 2] = point.z
      }
      if (innerGlowPositionAttribute) {
        innerGlowPositionAttribute.array[offset] = point.x
        innerGlowPositionAttribute.array[offset + 1] = point.y
        innerGlowPositionAttribute.array[offset + 2] = point.z
      }
      if (outerGlowPositionAttribute) {
        outerGlowPositionAttribute.array[offset] = point.x
        outerGlowPositionAttribute.array[offset + 1] = point.y
        outerGlowPositionAttribute.array[offset + 2] = point.z
      }

      if (nodeColorAttribute) {
        writeBrightness(nodeColorAttribute.array, offset, depthBrightness)
      }
      if (innerGlowColorAttribute) {
        writeBrightness(innerGlowColorAttribute.array, offset, depthBrightness)
      }
      if (outerGlowColorAttribute) {
        writeBrightness(outerGlowColorAttribute.array, offset, depthBrightness)
      }
    })

    if (nodePositionAttribute) nodePositionAttribute.needsUpdate = true
    if (innerGlowPositionAttribute) innerGlowPositionAttribute.needsUpdate = true
    if (outerGlowPositionAttribute) outerGlowPositionAttribute.needsUpdate = true
    if (nodeColorAttribute) nodeColorAttribute.needsUpdate = true
    if (innerGlowColorAttribute) innerGlowColorAttribute.needsUpdate = true
    if (outerGlowColorAttribute) outerGlowColorAttribute.needsUpdate = true

    if (lineGeometryRef.current) {
      const positionAttribute = lineGeometryRef.current.attributes.position
      const colorAttribute = lineGeometryRef.current.attributes.color
      const positionArray = positionAttribute.array
      const colorArray = colorAttribute.array

      edges.forEach((edge, edgeIndex) => {
        const pointA = currentPoints[edge.a]
        const pointB = currentPoints[edge.b]
        const offset = edgeIndex * 6

        positionArray[offset] = pointA.x
        positionArray[offset + 1] = pointA.y
        positionArray[offset + 2] = pointA.z
        positionArray[offset + 3] = pointB.x
        positionArray[offset + 4] = pointB.y
        positionArray[offset + 5] = pointB.z

        writeBrightness(colorArray, offset, depthFactors[edge.a])
        writeBrightness(colorArray, offset + 3, depthFactors[edge.b])
      })

      positionAttribute.needsUpdate = true
      colorAttribute.needsUpdate = true
    }
  })

  return (
    <group>
      <lineSegments renderOrder={0}>
        <bufferGeometry ref={lineGeometryRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[connectionPositions, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[connectionColors, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color="#e8edf8"
          vertexColors
          transparent
          opacity={0.23}
          linewidth={1.2}
          depthWrite={false}
          blending={THREE.NormalBlending}
        />
      </lineSegments>

      <points frustumCulled={false} renderOrder={1}>
        <bufferGeometry ref={nodeGeometryRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[nodePositions, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[nodeColors, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          map={nodeTexture}
          color="#ffffff"
          vertexColors
          size={NODE_SIZE_PX}
          sizeAttenuation={false}
          transparent
          opacity={1}
          alphaTest={0.35}
          depthWrite
          depthTest
          blending={THREE.NormalBlending}
          toneMapped={false}
        />
      </points>

      <points frustumCulled={false} renderOrder={2}>
        <bufferGeometry ref={innerGlowGeometryRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[innerGlowPositions, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[innerGlowColors, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          map={glowTexture}
          color="#e8f1ff"
          vertexColors
          size={INNER_GLOW_SIZE_PX}
          sizeAttenuation={false}
          transparent
          opacity={0.46}
          alphaTest={0.006}
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>

      <points frustumCulled={false} renderOrder={3}>
        <bufferGeometry ref={outerGlowGeometryRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[outerGlowPositions, 3]}
          />
          <bufferAttribute
            attach="attributes-color"
            args={[outerGlowColors, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          map={glowTexture}
          color="#b9d5ff"
          vertexColors
          size={OUTER_GLOW_SIZE_PX}
          sizeAttenuation={false}
          transparent
          opacity={0.17}
          alphaTest={0.002}
          depthWrite={false}
          depthTest
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
    </group>
  )
}
