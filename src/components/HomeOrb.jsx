import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const NODE_COUNT = 96
const RADIUS = 2.25

const SPRING_STRENGTH = 42
const SPRING_DAMPING = 9.4
const MAX_ORBIT_SPEED = 1.8
const MAX_STRETCH = 0.075
const MAX_TANGENTIAL_LAG = 0.036

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

function createConnectionIndices(points) {
  const pairs = []

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
      if (candidateIndex > index) {
        pairs.push(index, candidateIndex)
      }
    })
  })

  return pairs
}

function createConnectionBuffer(points, connectionIndices) {
  const positions = new Float32Array(connectionIndices.length * 3)

  connectionIndices.forEach((pointIndex, bufferIndex) => {
    const point = points[pointIndex]
    const offset = bufferIndex * 3
    positions[offset] = point.x
    positions[offset + 1] = point.y
    positions[offset + 2] = point.z
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
  const previousCameraDirection = useRef(new THREE.Vector3())
  const hasPreviousCameraDirection = useRef(false)

  const restPoints = useMemo(() => createSpherePoints(), [])
  const responseFactors = useMemo(
    () => restPoints.map((_, index) => 0.92 + Math.sin(index * 2.173) * 0.08),
    [restPoints],
  )
  const connectionIndices = useMemo(
    () => createConnectionIndices(restPoints),
    [restPoints],
  )
  const connectionPositions = useMemo(
    () => createConnectionBuffer(restPoints, connectionIndices),
    [connectionIndices, restPoints],
  )
  const currentPoints = useMemo(
    () => restPoints.map((point) => point.clone()),
    [restPoints],
  )
  const velocities = useMemo(
    () => restPoints.map(() => new THREE.Vector3()),
    [restPoints],
  )

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const scratch = useMemo(
    () => ({
      cameraDirection: new THREE.Vector3(),
      orbitAxis: new THREE.Vector3(),
      motionDirection: new THREE.Vector3(),
      localTangent: new THREE.Vector3(),
      target: new THREE.Vector3(),
      springDelta: new THREE.Vector3(),
    }),
    [],
  )

  useLayoutEffect(() => {
    applyMatrices(nodeRef.current, currentPoints, dummy, 1)
    applyMatrices(glowRef.current, currentPoints, dummy, 2.45)
  }, [currentPoints, dummy])

  useFrame((state, frameDelta) => {
    const dt = Math.min(frameDelta, 1 / 30)
    const cameraDirection = scratch.cameraDirection
      .copy(state.camera.position)
      .normalize()

    if (!hasPreviousCameraDirection.current) {
      previousCameraDirection.current.copy(cameraDirection)
      hasPreviousCameraDirection.current = true
    }

    const previousDirection = previousCameraDirection.current
    const orbitAxis = scratch.orbitAxis.crossVectors(
      previousDirection,
      cameraDirection,
    )
    const sinAngle = orbitAxis.length()
    const dot = THREE.MathUtils.clamp(previousDirection.dot(cameraDirection), -1, 1)

    let orbitSpeed = 0

    if (sinAngle > 0.000001 && dt > 0) {
      const angle = Math.atan2(sinAngle, dot)
      orbitAxis.multiplyScalar(1 / sinAngle)
      orbitSpeed = Math.min(angle / dt, MAX_ORBIT_SPEED)
    }

    previousDirection.copy(cameraDirection)

    const motionAmount = THREE.MathUtils.smoothstep(orbitSpeed, 0.08, 1.15)
    const damping = Math.exp(-SPRING_DAMPING * dt)

    if (motionAmount > 0 && orbitAxis.lengthSq() > 0) {
      scratch.motionDirection
        .crossVectors(orbitAxis, cameraDirection)
        .normalize()
    }

    currentPoints.forEach((point, index) => {
      const restPoint = restPoints[index]
      const target = scratch.target.copy(restPoint)

      if (motionAmount > 0 && orbitAxis.lengthSq() > 0) {
        const motionDirection = scratch.motionDirection
        const motionCoordinate = restPoint.dot(motionDirection) / RADIUS
        const axisCoordinate = restPoint.dot(orbitAxis) / RADIUS
        const silhouetteWeight = 1 - 0.32 * Math.abs(axisCoordinate)
        const response = responseFactors[index]
        const stretch = MAX_STRETCH * motionAmount * silhouetteWeight * response

        // Stretch the silhouette in the drag direction while slightly compressing
        // the perpendicular rotation axis. This makes the orb visibly deform
        // instead of behaving like a rigid sphere that merely rotates late.
        target.addScaledVector(
          motionDirection,
          restPoint.dot(motionDirection) * stretch,
        )
        target.addScaledVector(
          orbitAxis,
          restPoint.dot(orbitAxis) * -stretch * 0.24,
        )

        // Give different regions a slightly different rotational lag so the
        // graph feels like one soft, connected mass rather than a rigid shell.
        scratch.localTangent.crossVectors(orbitAxis, restPoint)
        const sideBias = 0.62 + 0.38 * (0.5 + 0.5 * motionCoordinate)
        target.addScaledVector(
          scratch.localTangent,
          -MAX_TANGENTIAL_LAG * motionAmount * sideBias * response,
        )
      }

      const springStrength = SPRING_STRENGTH * responseFactors[index]
      scratch.springDelta
        .copy(target)
        .sub(point)
        .multiplyScalar(springStrength * dt)

      velocities[index].add(scratch.springDelta)
      velocities[index].multiplyScalar(damping)
      point.addScaledVector(velocities[index], dt)

      if (nodeRef.current) {
        dummy.position.copy(point)
        dummy.scale.setScalar(1)
        dummy.updateMatrix()
        nodeRef.current.setMatrixAt(index, dummy.matrix)
      }

      if (glowRef.current) {
        dummy.position.copy(point)
        dummy.scale.setScalar(2.45)
        dummy.updateMatrix()
        glowRef.current.setMatrixAt(index, dummy.matrix)
      }
    })

    if (nodeRef.current) {
      nodeRef.current.instanceMatrix.needsUpdate = true
    }

    if (glowRef.current) {
      glowRef.current.instanceMatrix.needsUpdate = true
    }

    if (lineGeometryRef.current) {
      const positionAttribute = lineGeometryRef.current.attributes.position
      const array = positionAttribute.array

      connectionIndices.forEach((pointIndex, bufferIndex) => {
        const point = currentPoints[pointIndex]
        const offset = bufferIndex * 3
        array[offset] = point.x
        array[offset + 1] = point.y
        array[offset + 2] = point.z
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
