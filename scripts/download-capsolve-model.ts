import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const modelPath = process.env.CAPSOLVE_MODEL_PATH ?? `${process.cwd()}/models/model.onnx`
const modelOrigin = process.env.CAPSOLVE_MODEL_ORIGIN ?? 'https://huggingface.co'
const modelUrl = new URL('/nakasyou/capsolve-sp/resolve/main/model.onnx', modelOrigin)

try {
  if (await Bun.file(modelPath).exists()) {
    console.log(`capsolve-sp model already exists at ${modelPath}`)
    process.exit(0)
  }
  await mkdir(dirname(modelPath), { recursive: true })
  const response = await fetch(modelUrl)
  if (!response.ok)
    throw new Error(`model download failed: ${response.status} ${response.statusText}`)
  await Bun.write(modelPath, await response.arrayBuffer())
  console.log(`Downloaded capsolve-sp model to ${modelPath}`)
} catch (cause) {
  console.error(cause)
  process.exit(1)
}
