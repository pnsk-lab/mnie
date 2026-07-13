<script setup lang="ts">
import { ref } from 'vue'
import {
  createMobileSuicaCaptcha,
  createMobileSuicaReauthCaptcha,
  submitMobileSuicaCaptcha,
} from '../../api'
import { ui } from '../../styles/ui'

const user = ref('')
const label = ref('Mobile Suica')
const password = ref('')
const challengeId = ref('')
const captchaImage = ref('')
const captchaAnswer = ref('')
const busy = ref(false)
const error = ref('')
const saved = ref(false)
const props = defineProps<{ reauth?: boolean; profileId?: string }>()
const emit = defineEmits<{ reauthenticated: [profileId: string] }>()

const requestCaptcha = async () => {
  busy.value = true
  error.value = ''
  saved.value = false
  try {
    const challenge =
      props.reauth && props.profileId
        ? await createMobileSuicaReauthCaptcha(props.profileId)
        : await createMobileSuicaCaptcha({
            label: label.value,
            user: user.value,
            password: password.value,
          })
    challengeId.value = challenge.id
    captchaImage.value = challenge.imageDataUrl
    captchaAnswer.value = challenge.suggestedAnswer
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'CAPTCHA を取得できませんでした'
  } finally {
    busy.value = false
  }
}

const submitCaptcha = async () => {
  if (!challengeId.value) return
  busy.value = true
  error.value = ''
  try {
    await submitMobileSuicaCaptcha(challengeId.value, captchaAnswer.value)
    if (props.reauth && props.profileId) emit('reauthenticated', props.profileId)
    saved.value = true
    password.value = ''
    challengeId.value = ''
    captchaImage.value = ''
    captchaAnswer.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'ログインできませんでした'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <article class="grid min-w-0 content-start gap-4 overflow-hidden bg-transparent">
    <label v-if="!props.reauth" :class="ui.label">
      名前
      <input v-model="label" :class="ui.input" />
    </label>
    <label v-if="!props.reauth" :class="ui.label">
      メールアドレス
      <input v-model="user" :class="ui.input" type="email" autocomplete="username" />
    </label>
    <label v-if="!props.reauth" :class="ui.label">
      パスワード
      <input v-model="password" :class="ui.input" type="password" autocomplete="current-password" />
    </label>
    <button :class="ui.primaryButton" type="button" :disabled="busy" @click="requestCaptcha">
      {{ props.reauth ? '再認証' : 'CAPTCHA を表示' }}
    </button>
    <template v-if="captchaImage">
      <img
        :src="captchaImage"
        alt="モバイル Suica CAPTCHA"
        class="h-auto max-w-full rounded bg-white"
      />
      <label :class="ui.label">
        CAPTCHA の文字
        <input v-model="captchaAnswer" :class="ui.input" autocomplete="off" spellcheck="false" />
      </label>
      <div class="flex justify-end">
        <button :class="ui.primaryButton" type="button" :disabled="busy" @click="submitCaptcha">
          保存
        </button>
      </div>
    </template>
    <p v-if="error" class="text-sm font-semibold text-red-300" role="alert">{{ error }}</p>
    <p v-if="saved" class="text-sm font-semibold text-emerald-300" role="status">
      登録が完了しました。
    </p>
  </article>
</template>
