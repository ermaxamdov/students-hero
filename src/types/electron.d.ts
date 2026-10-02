export interface AppDataEntry {
  path: string
  exists: boolean
}

export interface StudentHeroElectronAPI {
  getAppDataInfo: () => Promise<Record<string, AppDataEntry>>
  openAppDataPath: (key: string) => Promise<{ ok: boolean }>
  clearAllUserData: () => Promise<{ ok: boolean; removedTasks: number }>
  hibernate: () => Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    electronAPI?: StudentHeroElectronAPI
  }
}

export {}
