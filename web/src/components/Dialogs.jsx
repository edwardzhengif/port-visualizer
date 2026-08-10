import { AlertDialog, Button, Modal } from '@heroui/react';
import PortDetail from './PortDetail.jsx';

/*
 * 弹窗的嵌套关系不能写错，这是踩过的坑：
 *
 *   Modal.Backdrop  → react-aria 的 ModalOverlay
 *   Modal.Container → react-aria 的 Modal
 *   Modal.Dialog    → react-aria 的 Dialog
 *
 * 三者必须**层层嵌套**，不是并列。写成并列时 Overlay 会正常渲染，
 * 但 Modal/Dialog 根本不会挂载 —— 表现是「只看到一层暗色遮罩，里面什么都没有」，
 * 而且不报任何错。
 */

/**
 * 终止确认。
 *
 * 用 AlertDialog 而不是 Modal —— 它带 role="alertdialog"，
 * 屏幕阅读器会把内容当作需要立刻响应的重要信息播报。
 *
 * 内容顺序刻意如此：先说这是什么，再说杀了会怎样，最后才是按钮。
 * 只问「确定要终止吗」不含任何帮助决策的信息。
 */
export function KillConfirm({ target, onCancel, onConfirm, t }) {
  if (!target) return null;
  const a = target.analysis;

  return (
    <AlertDialog isOpen onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialog.Backdrop>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="max-w-[520px]">
            <AlertDialog.Header>
              <AlertDialog.Heading>{t('dlgKillTitle')}</AlertDialog.Heading>
            </AlertDialog.Header>

            <AlertDialog.Body className="space-y-3 text-sm">
              <p className="text-muted leading-relaxed text-pretty">
                {t('dlgKillBody', a.title, target.process, target.pid, target.protocol, target.port)}
              </p>
              <div className="bg-surface-secondary border-border space-y-1 rounded-lg border px-3 py-2 text-xs leading-relaxed">
                <p>
                  <span className="text-risk-medium font-medium">{t('dlgIfKilled')}</span>
                  <span className="text-muted"> {a.ifKilled}</span>
                </p>
                <p>
                  <span className="text-risk-medium font-medium">{t('dlgRiskLevel')}</span>
                  <span className="text-muted"> {a.riskLabel}{a.uptime ? t('dlgUptime', a.uptime) : ''}</span>
                </p>
              </div>
            </AlertDialog.Body>

            {/* 破坏性操作与「取消」拉开距离 —— 挨着放会让两者看起来同等分量 */}
            <AlertDialog.Footer className="flex justify-between">
              {/* 焦点默认落在安全选项上 */}
              <Button variant="outline" autoFocus onPress={onCancel}>{t('cancel')}</Button>
              <Button variant="danger" onPress={onConfirm}>{t('confirmKill')}</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

/** 字段说明：把每个字段用大白话讲清楚，给不熟悉网络概念的人看。 */
export function FieldTips({ tips, onClose, t }) {
  if (!tips) return null;

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-h-[80dvh] max-w-[560px] overflow-y-auto">
            <Modal.Header>
              <Modal.Heading>{t('dlgTipsTitle')}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3">
              {Object.entries(tips).map(([key, v]) => (
                <div key={key} className="bg-surface-secondary border-border rounded-lg border px-3 py-2">
                  <p className="text-accent mb-1 text-sm font-medium">{v.title}</p>
                  <p className="text-muted text-xs leading-relaxed text-pretty">{v.tip}</p>
                </div>
              ))}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/**
 * 详情弹窗，卡片和表格共用。
 *
 * 卡片改成三列网格后，就地展开会把整行三张卡片一起撑高 ——
 * 你只点了一张，旁边两张跟着变形。表格那边则是：之前点端口号会切到卡片视图，
 * 视图被换掉、滚动位置丢失，是交互断层。两个问题的同一个答案就是原地开弹窗。
 */
export function PortDetailDialog({ port, platform, readonly, unlocked, onUnlock, onCopy, onClose, t, lang }) {
  if (!port) return null;

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-h-[80dvh] max-w-[640px] overflow-y-auto">
            <Modal.Header>
              <Modal.Heading>
                <span className="tabular">{t('dlgDetailTitle', port.port)}</span>
                <span className="text-muted"> · {port.analysis.title}</span>
              </Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body>
              <PortDetail
                port={port}
                platform={platform}
                readonly={readonly}
                unlocked={unlocked}
                onUnlock={onUnlock}
                onCopy={onCopy}
                t={t}
                lang={lang}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/**
 * 「这个进程不是你的」——解释 + 给命令，而不是把人堵在墙前面。
 *
 * 用户最常问的是「我自己的电脑，为什么有不属于我的进程」。
 * 答案值得写在界面上：macOS 给每个系统服务单独建低权限账号，
 * 这样某个服务被攻破时攻击者拿到的只是那个受限账号 —— 是刻意的安全设计。
 * 代价就是 Unix 只允许你对同账号的进程发信号。
 */
export function SudoHint({ port, onCopy, onClose, t }) {
  if (!port) return null;
  const cmd = `sudo kill -15 ${port.pid}`;

  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-w-[560px]">
            <Modal.Header>
              <Modal.Heading>{t('dlgSudoTitle')}</Modal.Heading>
              <Modal.CloseTrigger />
            </Modal.Header>
            <Modal.Body className="space-y-3 text-sm">
              <p className="text-muted leading-relaxed text-pretty">
                {t('dlgSudoBody', port.process, port.pid, port.user || t('unknownUser'))}
              </p>
              <p className="text-muted text-xs leading-relaxed text-pretty">{t('dlgSudoWhy')}</p>

              <div className="bg-surface-secondary border-border flex items-center gap-2 rounded-lg border px-3 py-2">
                <code className="text-accent flex-1 text-xs break-all">{cmd}</code>
                <Button size="sm" variant="outline" onPress={() => onCopy(cmd, t('cmdLabel'))}>{t('copy')}</Button>
              </div>

              <p className="text-muted text-xs leading-relaxed">{t('dlgSudoHow')}</p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="outline" onPress={onClose}>{t('gotIt')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
