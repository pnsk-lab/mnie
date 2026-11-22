import fs from 'node:fs'

const inputDir = process.argv[2]
const outputDir = process.argv[3] ?? inputDir

if (!inputDir) {
  console.error('usage: node decompile-kxz-wasm.mjs <wasm-dir> [wat-dir]')
  process.exitCode = 2
} else {
  let wabt
  try {
    const moduleName = process.env.WABT_MODULE ?? 'wabt'
    wabt = await import(moduleName).then((module) => module.default?.() ?? module())
  } catch (cause) {
    console.error('Install wabt first (for example: npm install --no-save wabt).', cause)
    process.exitCode = 1
  }

  if (wabt) {
    fs.mkdirSync(outputDir, { recursive: true })
    for (const file of fs.readdirSync(inputDir).filter((name) => name.endsWith('.wasm'))) {
      const wasm = new Uint8Array(fs.readFileSync(`${inputDir}/${file}`))
      const module = wabt.readWasm(wasm, { readDebugNames: true })
      module.generateNames()
      const wat = module.toText({
        foldExprs: false,
        inlineExport: false,
        generateDebugNames: true,
      })
      const output = `${outputDir}/${file.replace(/\.wasm$/, '.wat')}`
      fs.writeFileSync(output, wat)
      module.destroy()
      console.log(output)
    }
  }
}
