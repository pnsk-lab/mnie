import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    singleQuote: true,
    semi: false,
  },
  run: {
    cache: true,
    tasks: {
      'app:dev': {
        command: 'vp run @repo/mnie-app#dev',
        cache: false,
        dependsOn: ['env:doctor', 'sdk-build'],
      },
      'app:build': {
        command: 'vp run @repo/mnie-app#build',
        dependsOn: ['typecheck:all', 'sdk-build'],
      },
      'sdk-build': {
        dependsOn: [
          '@mnie/types#build',
          '@mnie/provider-sbi-sec#build',
          '@mnie/provider-mobile-suica#build',
          '@mnie/provider-paypay#build',
          '@mnie/provider-paypay-bank#build',
          '@repo/client-mnie#build',
          '@mnie/provider-smbc-direct#build',
          '@mnie/cli#build',
        ],
        command: 'echo "SDK build complete"',
        cache: true
      },
      'app:start': {
        command: 'vp run @repo/mnie-app#start',
        cache: false,
      },
      'server:db:push': {
        command: 'vp run @repo/mnie-server#db:push',
        cache: false,
        dependsOn: ['env:doctor'],
      },
      'env:doctor': {
        command: 'bun --env-file=.env scripts/check-env.ts',
        cache: false,
      },
      'typecheck:all': {
        command: 'vp run --filter "./apps/*" --filter "./packages/*" typecheck',
      },
      clean: {
        command: 'vp run --filter "./apps/*" --filter "./packages/*" clean',
        cache: false,
      },
      verify: {
        command: ['vp check', 'vp run typecheck:all', 'vp run app:build'],
      },
      'docker:build':
        'docker build -f apps/mnie-app/Dockerfile -t "${MNIE_IMAGE:-ghcr.io/pnsk-lab/mnie:latest}" .',
      'docker:run':
        'docker run --rm -p 8787:8787 --env-file .env -v "$PWD/data:/app/data" "${MNIE_IMAGE:-ghcr.io/pnsk-lab/mnie:latest}"',
      'docker:push': 'docker push "${MNIE_IMAGE:-ghcr.io/pnsk-lab/mnie:latest}"',
      'docs:dev': {
        command: 'vp run @repo/docs#dev',
        cache: false,
      },
      'docs:build': {
        command: 'vp run @repo/docs#build',
      },
    },
  },
})
