<script setup lang="ts">
import Spinner from '../../components/ui/Spinner.vue'
import { notifyError } from '../feedback/feedback'
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
const props = defineProps<{
  reauth?: boolean
  profileId?: string
  onSaved?: (profileId: string) => Promise<void>
}>()
const emit = defineEmits<{ reauthenticated: [profileId: string] }>()

const requestCaptcha = async () => {
  if (busy.value) return
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
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const { profile } = await submitMobileSuicaCaptcha(challengeId.value, captchaAnswer.value)
    if (props.reauth && props.profileId) emit('reauthenticated', props.profileId)
    saved.value = true
    password.value = ''
    challengeId.value = ''
    captchaImage.value = ''
    captchaAnswer.value = ''
    await props.onSaved?.(profile.id).catch(notifyError)
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
    <button
      :class="ui.primaryButton"
      type="button"
      :disabled="busy"
      :aria-busy="busy"
      @click="requestCaptcha"
    >
      <Spinner v-if="busy" size="sm" />
      {{ captchaImage ? 'CAPTCHA を再取得' : props.reauth ? '再認証' : 'CAPTCHA を表示' }}
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
        <button
          :class="ui.primaryButton"
          type="button"
          :disabled="busy"
          :aria-busy="busy"
          @click="submitCaptcha"
        >
          <Spinner v-if="busy" size="sm" />
          ログイン
        </button>
      </div>
    </template>
    <p v-if="error" class="text-sm font-semibold text-red-300" role="alert">{{ error }}</p>
    <p v-if="saved" class="text-sm font-semibold text-emerald-300" role="status">
      {{ props.reauth ? '再認証が完了しました。' : '登録が完了しました。' }}
    </p>
  </article>
</template>
