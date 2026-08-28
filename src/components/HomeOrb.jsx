import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const NODE_COUNT = 96
const RADIUS = 2.25

const EDGE_STIFFNESS = 19
const EDGE_DAMPING = 2.6
const ANCHOR_STIFFNESS = 2.2
const RADIAL_STIFFNESS = 4.6
const NODE_DAMPING = 3.4
const MOTION_FORCE = 1.85
const MAX_ANGULAR_SPEED = 3.2
const MAX_OFFSET = 0.34
const SUBSTEPS = 3

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

function applyMatrices(mesh, points, dummy, scale = 1) {
  if (!mesh) return

  points.forEach((point, index) => {
    dummy.position.copy(point)
    dummy.scale.setScalar(scale)
    dummy.updateMatrix()
    mesh.setMatrixAt(index, dummy.matrix)
  })

  mesh.instanceMatrix.needsUpdate = true
}

export default function HomeOrb() {
  const nodeRef = useRef()
  const glowRef = useRef()
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
  const edges = useMemo(() => createConnections(restPoints), [restPoints])
  const connectionPositions = useMemo(
    () => createConnectionBuffer(restPoints, edges),
    [edges, restPoints],
  )

  const dummy = useMemo(() => new THREE.Object3D(), [])
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

  useLayoutEffect(() => {
    applyMatrices(nodeRef.current, currentPoints, dummy, 1)
    applyMatrices(glowRef.current, currentPoints, dummy, 2.45)
  }, [currentPoints, dummy])

  useFrame((state, frameDelta) => {
    const dt = Math.min(frameDelta, 1 / 30)
    const cameraQuaternion = state.camera.quaternion

    if (!hasPreviousCameraQuaternion.current) {
      previousCameraQuaternion.current.copy(cameraQuaternion)
      hasPreviousCameraQuaternion.current = true
    }

    scratch.inversePrevious
      .copy(previousCameraQuaternion.current)
      .invert()
    scratch.deltaQuaternion
      .copy(cameraQuaternion)
      .multiply(scratch.inversePrevious)

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
      scratch.angularVelocity
        .copy(scratch.angularAxis)
        .multiplyScalar(angularSpeed)
    }

    previousCameraQuaternion.current.copy(cameraQuaternion)

    scratch.cameraDirection
      .copy(state.camera.position)
      .normalize()

    const motionAmount = THREE.MathUtils.smoothstep(angularSpeed, 0.025, 0.9)
    const step = dt / SUBSTEPS

    for (let substep = 0; substep < SUBSTEPS; substep += 1) {
      forces.forEach((force) => force.set(0, 0, 0))

      currentPoints.forEach((point, index) => {
        const restPoint = restPoints[index]
        const response = responseFactors[index]

        scratch.anchorDelta
          .copy(restPoint)
          .sub(point)
        forces[index].addScaledVector(
          scratch.anchorDelta,
          ANCHOR_STIFFNESS * response,
        )

        const radius = Math.max(point.length(), 0.0001)
        const radialError = radius - RADIUS
        scratch.radialDirection
          .copy(point)
          .multiplyScalar(1 / radius)
        forces[index].addScaledVector(
          scratch.radialDirection,
          -radialError * RADIAL_STIFFNESS,
        )

        if (motionAmount > 0) {
          scratch.tangent.crossVectors(scratch.angularVelocity, point)

          const facing = THREE.MathUtils.clamp(
            point.dot(scratch.cameraDirection) / RADIUS,
            -1,
            1,
          )
          const frontWeight = THREE.MathUtils.smoothstep(facing, -0.15, 0.82)

          scratch.projected.copy(point).project(state.camera)
          const dx = scratch.projected.x - state.pointer.x
          const dy = scratch.projected.y - state.pointer.y
          const pointerDistanceSq = dx * dx + dy * dy
          const pointerWeight = Math.exp(-pointerDistanceSq / 0.26)

          const contactWeight =
            frontWeight * (0.12 + 0.88 * pointerWeight)
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
        scratch.direction
          .copy(scratch.delta)
          .multiplyScalar(1 / distance)

        const stretch = distance - edge.restLength
        const relativeSpeed = scratch
          .delta
          .copy(velocityB)
          .sub(velocityA)
          .dot(scratch.direction)

        const forceMagnitude =
          EDGE_STIFFNESS * stretch + EDGE_DAMPING * relativeSpeed

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

    applyMatrices(nodeRef.current, currentPoints, dummy, 1)
    applyMatrices(glowRef.current, currentPoints, dummy, 2.45)

    if (lineGeometryRef.current) {
      const positionAttribute = lineGeometryRef.current.attributes.position
      const array = positionAttribute.array

      edges.forEach((edge, edgeIndex) => {
        const pointA = currentPoints[edge.a]
        const pointB = currentPoints[edge.b]
        const offset = edgeIndex * 6

        array[offset] = pointA.x
        array[offset + 1] = pointA.y
        array[offset + 2] = pointA.z
        array[offset + 3] = pointB.x
        array[offset + 4] = pointB.y
        array[offset + 5] = pointB.z
      })

      positionAttribute.needsUpdate = true
    }
  })

  return (
    <group>
      <lineSegments>
        <bufferGeometry ref={lineGeometryRef}>
          <bufferAttribute
            attach="attributes-position"
            args={[connectionPositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color="#e8edf8"
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>

      <instancedMesh
        ref={glowRef}
        args={[null, null, NODE_COUNT]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.032, 10, 10]} />
        <meshBasicMaterial
          color="#d9e4ff"
          transparent
          opacity={0.085}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>

      <instancedMesh
        ref={nodeRef}
        args={[null, null, NODE_COUNT]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.032, 12, 12]} />
        <meshBasicMaterial color="#f7f8fb" toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
