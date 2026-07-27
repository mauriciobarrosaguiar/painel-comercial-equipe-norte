import { useState } from 'react'
import { downloadReportImages } from './download-report-images'

type Props = {
  query: string
}

export default function DownloadImagesButton({ query }: Props) {
  const [loading, setLoading] = useState(false)

  async function download() {
    if (loading) return
    setLoading(true)
    try {
      await downloadReportImages(query)
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'Não foi possível gerar as imagens.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className="secondary-button dashboard-ppt-button"
      onClick={() => void download()}
      disabled={loading}
    >
      {loading ? 'Gerando PNGs…' : 'Baixar imagens'}
    </button>
  )
}
