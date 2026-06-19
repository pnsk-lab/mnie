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
        command: 'vp run @repo/csbie#dev',
        cache: false,
        dependsOn: ['env:doctor'],
      },
      'app:build': {
        command: 'vp run @repo/csbie#build',
        dependsOn: ['typecheck:all'],
      },
      'app:start': {
        command: 'vp run @repo/csbie#start',
        cache: false,
      },
      'server:db:push': {
        command: 'vp run @repo/csbie-server#db:push',
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
        'docker build --no-cache -f apps/csbie/Dockerfile -t git.yutakobayashi.com/nakasyou/csbi:latest .',
      'docker:run':
        'docker run --rm -p 8787:8787 --env-file .env -v "$PWD/data:/app/data" git.yutakobayashi.com/nakasyou/csbi:latest',
      'docker:tag':
        'docker tag git.yutakobayashi.com/nakasyou/csbi:latest git.yutakobayashi.com/nakasyou/csbi:latest',
      'docker:push': 'docker push git.yutakobayashi.com/nakasyou/csbi:latest',
    },
  },
})
