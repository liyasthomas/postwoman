import { Plugin } from "vue"

import "./assets/scss/styles.scss"
import "virtual:windi.css"

export type HoppUIPluginOptions = {
  t?: (key: string) => string
  onModalOpen?: () => void
  onModalClose?: () => void
}

const plugin: Plugin = {
  install(app, options: HoppUIPluginOptions = {}) {
    app.provide("HOPP_UI_OPTIONS", options)
  },
}

export default plugin
