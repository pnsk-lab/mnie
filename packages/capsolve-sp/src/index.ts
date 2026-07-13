import { InferenceSession, Tensor } from 'onnxruntime-node'
import sharp from 'sharp'
import { access } from 'node:fs/promises'

const CHARACTERS = '0123456789abcdefghijklmnopqrstuvwxyz'
const WIDTH = 175
const HEIGHT = 60

export interface CaptchaSolver {
  solve(image: Uint8Array | ArrayBuffer): Promise<string>
}

export const captchaModelPath = () =>
  process.env.CAPSOLVE_MODEL_PATH ?? `${process.cwd()}/../../models/model.onnx`

export const assertCaptchaModel = async (modelPath = captchaModelPath()) => {
  try {
    await access(modelPath)
  } catch {
    throw new Error(`capsolve-sp model is missing: ${modelPath}; run bun install again`)
  }
}

export const createCaptchaSolver = async (modelPath: string): Promise<CaptchaSolver> => {
  const session = await InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  })

  return {
    solve: async (image) => {
      const bytes = image instanceof ArrayBuffer ? new Uint8Array(image) : image
      const pixels = await sharp(Buffer.from(bytes))
        .resize(WIDTH, HEIGHT, { fit: 'fill' })
        .removeAlpha()
        .greyscale()
        .raw()
        .toBuffer()
      const input = new Float32Array(WIDTH * HEIGHT)
      for (let index = 0; index < input.length; index += 1)
        input[index] = (255 - (pixels[index] ?? 0)) / 255

      const output = await session.run({
        image: new Tensor('float32', input, [1, 1, HEIGHT, WIDTH]),
      })
      const logits = output.logits?.data
      if (!logits) throw new Error('capsolve-sp model did not return logits')
      let result = ''
      for (let position = 0; position < 5; position += 1) {
        let best = 0
        for (let classIndex = 1; classIndex < CHARACTERS.length; classIndex += 1) {
          if (
            Number(logits[position * CHARACTERS.length + classIndex]) >
            Number(logits[position * CHARACTERS.length + best])
          )
            best = classIndex
        }
        result += CHARACTERS[best]
      }
      return result
    },
  }
}
