<script setup lang="ts">
import { ref } from 'vue'
import {
  createMobileSuicaCaptcha,
  submitMobileSuicaCaptcha,
  type MobileSuicaUsageHistoryItem,
} from '../../api'
import { ui } from '../../styles/ui'

const baseURL = ref('')
const user = ref('')
const password = ref('')
const challengeId = ref('')
const captchaImage = ref('')
const captchaAnswer = ref('')
const usageHistory = ref<MobileSuicaUsageHistoryItem[]>([])
const busy = ref(false)
const error = ref('')

const requestCaptcha = async () => {
  busy.value = true
  error.value = ''
  usageHistory.value = []
  try {
    const challenge = await createMobileSuicaCaptcha({
      baseURL: baseURL.value,
      user: user.value,
      password: password.value,
    })
    challengeId.value = challenge.id
    captchaImage.value = challenge.imageDataUrl
    captchaAnswer.value = ''
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
    const result = await submitMobileSuicaCaptcha(challengeId.value, captchaAnswer.value)
    usageHistory.value = result.usageHistory
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
    <div>
      <h3 class="text-lg font-black">モバイル Suica 利用履歴</h3>
      <p class="mt-1 text-sm text-[#9aa0a9]">認証情報とログイン Cookie は暗号化して保存します。</p>
    </div>
    <label :class="ui.label">
      Web サイトの Origin
      <input
        v-model="baseURL"
        :class="ui.input"
        placeholder="https://example.invalid"
        inputmode="url"
      />
    </label>
    <label :class="ui.label">
      メールアドレス
      <input v-model="user" :class="ui.input" type="email" autocomplete="username" />
    </label>
    <label :class="ui.label">
      パスワード
      <input v-model="password" :class="ui.input" type="password" autocomplete="current-password" />
    </label>
    <button :class="ui.primaryButton" type="button" :disabled="busy" @click="requestCaptcha">
      CAPTCHA を表示
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
      <button :class="ui.primaryButton" type="button" :disabled="busy" @click="submitCaptcha">
        利用履歴を取得
      </button>
    </template>
    <p v-if="error" class="text-sm font-semibold text-red-300" role="alert">{{ error }}</p>
    <div v-if="usageHistory.length" class="overflow-x-auto rounded-[18px] border border-[#30343a]">
      <table class="w-full min-w-[42rem] text-left text-sm">
        <thead class="bg-[#111418] text-[#9aa0a9]">
          <tr>
            <th class="p-3">日付</th>
            <th class="p-3">種別</th>
            <th class="p-3">詳細</th>
            <th class="p-3">金額</th>
            <th class="p-3">残高</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(item, index) in usageHistory"
            :key="`${item.date}-${index}`"
            class="border-t border-[#30343a]"
          >
            <td class="p-3">{{ item.date }}</td>
            <td class="p-3">{{ item.type }}</td>
            <td class="p-3">{{ item.detail }}</td>
            <td class="p-3">{{ item.amount ?? '-' }}</td>
            <td class="p-3">{{ item.balance ?? '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>
</template>
