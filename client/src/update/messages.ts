import type { InstallPhase } from './controller';
import { ChecksumMismatchError, SizeMismatchError } from './install';
import type { CheckResult } from './logic';
import { HttpError } from '../core/http';

export const MANUAL_INSTALL_NOTICE = '当前设备不支持在线安装，请联系管理员重新安装新版本。';

const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export function checkResultText(result: CheckResult): string {
  switch (result.status) {
    case 'disabled':
      return '此版本未配置更新服务';
    case 'unsupported':
      return '当前平台不支持在线更新';
    case 'up-to-date':
      return '已是最新版本';
    case 'available':
      return `发现新版本 v${result.release.versionName}`;
    case 'error':
      return result.error instanceof HttpError && result.error.status === 404 ? '暂无可用更新' : '检查更新失败，请稍后重试';
  }
}

/** Status line under the release notes; null when there is nothing to show. */
export function installPhaseText(install: InstallPhase): string | null {
  switch (install.phase) {
    case 'idle':
      return null;
    case 'downloading':
      if (install.progress === null) return install.bytes > 0 ? `正在下载 ${megabytes(install.bytes)} MB` : '正在下载…';
      return `正在下载 ${Math.floor(install.progress * 100)}%（${megabytes(install.bytes)} / ${megabytes(install.total ?? 0)} MB）`;
    case 'verifying':
      return '正在校验安装包…';
    case 'installing':
      return '正在打开安装程序…';
    case 'manual':
      return MANUAL_INSTALL_NOTICE;
    case 'error':
      return install.error instanceof SizeMismatchError || install.error instanceof ChecksumMismatchError
        ? '安装包校验失败，请稍后重试' : '下载失败，请稍后重试';
  }
}
