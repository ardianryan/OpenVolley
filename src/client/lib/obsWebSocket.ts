/**
 * Zero-dependency OBS WebSocket v5 browser client (OBS Studio 28+ built-in protocol).
 * Handles Hello/Identify SHA-256 auth, scene/transition control, CurrentProgramSceneChanged events,
 * and 1-click Browser Source provisioning across scenes.
 */

export interface ObsSceneInfo {
  sceneName: string;
  sceneIndex: number;
}

export interface ObsTransitionInfo {
  transitionName: string;
  transitionKind: string;
}

interface PendingReq {
  resolve: (data: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

async function sha256Base64(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  return btoa(bin);
}

export class ObsWebSocketClient {
  private ws: WebSocket | null = null;
  private reqCounter = 1;
  private pending = new Map<string, PendingReq>();
  private sceneChangeListeners = new Set<(sceneName: string) => void>();
  private closeListeners = new Set<(reason: string) => void>();

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  onSceneChanged(cb: (sceneName: string) => void): () => void {
    this.sceneChangeListeners.add(cb);
    return () => this.sceneChangeListeners.delete(cb);
  }

  onClose(cb: (reason: string) => void): () => void {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  async connect(url = 'ws://127.0.0.1:4455', password = ''): Promise<void> {
    this.disconnect();

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(url);
      this.ws = ws;

      const fail = (msg: string) => {
        if (!settled) {
          settled = true;
          reject(new Error(msg));
        }
        this.disconnect();
      };

      const timeout = window.setTimeout(() => {
        fail('Timeout menghubungi OBS WebSocket. Pastikan OBS Studio & WebSocket Server (port 4455) aktif.');
      }, 6000);

      ws.onerror = () => {
        window.clearTimeout(timeout);
        fail('Gagal terhubung ke OBS WebSocket (periksa port 4455 di Tools -> WebSocket Server Settings).');
      };

      ws.onclose = (ev) => {
        window.clearTimeout(timeout);
        const reason = ev.reason || `Koneksi OBS terputus (code ${ev.code})`;
        for (const p of this.pending.values()) {
          p.reject(new Error(reason));
        }
        this.pending.clear();
        this.ws = null;
        if (!settled) {
          settled = true;
          reject(new Error(reason));
        }
        for (const cb of this.closeListeners) cb(reason);
      };

      ws.onmessage = async (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            op: number;
            d: Record<string, unknown>;
          };

          // op 0: Hello
          if (msg.op === 0) {
            const auth = msg.d.authentication as
              | { challenge: string; salt: string }
              | undefined;
            const identifyData: Record<string, unknown> = {
              rpcVersion: 1,
              eventSubscriptions: 1 << 2, // Scenes events (CurrentProgramSceneChanged)
            };
            if (auth && auth.challenge && auth.salt) {
              if (!password) {
                window.clearTimeout(timeout);
                fail('OBS WebSocket membutuhkan Password Server.');
                return;
              }
              const secret = await sha256Base64(password + auth.salt);
              identifyData.authentication = await sha256Base64(secret + auth.challenge);
            }
            ws.send(JSON.stringify({ op: 1, d: identifyData }));
            return;
          }

          // op 2: Identified
          if (msg.op === 2) {
            window.clearTimeout(timeout);
            settled = true;
            resolve();
            return;
          }

          // op 5: Event
          if (msg.op === 5) {
            if (msg.d.eventType === 'CurrentProgramSceneChanged') {
              const eventData = msg.d.eventData as { sceneName?: string } | undefined;
              if (eventData?.sceneName) {
                for (const cb of this.sceneChangeListeners) {
                  cb(eventData.sceneName);
                }
              }
            }
            return;
          }

          // op 7: RequestResponse
          if (msg.op === 7) {
            const reqId = String(msg.d.requestId || '');
            const pending = this.pending.get(reqId);
            if (!pending) return;
            this.pending.delete(reqId);
            const status = msg.d.requestStatus as
              | { result: boolean; code: number; comment?: string }
              | undefined;
            if (status && !status.result) {
              pending.reject(
                new Error(status.comment || `OBS Request Error (${status.code})`)
              );
            } else {
              pending.resolve((msg.d.responseData as Record<string, unknown>) || {});
            }
          }
        } catch {
          // ignore malformed messages
        }
      };
    });
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.pending.clear();
  }

  request(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Belum terhubung ke OBS WebSocket.'));
    }
    const requestId = `ov-${this.reqCounter++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws!.send(
        JSON.stringify({
          op: 6,
          d: {
            requestType,
            requestId,
            ...(requestData ? { requestData } : {}),
          },
        })
      );
      window.setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(`Request ${requestType} timeout.`));
        }
      }, 6000);
    });
  }

  async getSceneList(): Promise<{
    currentProgramSceneName: string;
    scenes: ObsSceneInfo[];
  }> {
    const res = await this.request('GetSceneList');
    return {
      currentProgramSceneName: String(res.currentProgramSceneName || ''),
      scenes: Array.isArray(res.scenes) ? (res.scenes as ObsSceneInfo[]) : [],
    };
  }

  async getTransitionList(): Promise<{
    currentSceneTransitionName: string;
    transitions: ObsTransitionInfo[];
  }> {
    const res = await this.request('GetSceneTransitionList');
    return {
      currentSceneTransitionName: String(res.currentSceneTransitionName || ''),
      transitions: Array.isArray(res.transitions)
        ? (res.transitions as ObsTransitionInfo[])
        : [],
    };
  }

  async setCurrentScene(sceneName: string): Promise<void> {
    await this.request('SetCurrentProgramScene', { sceneName });
  }

  async setCurrentTransition(transitionName: string): Promise<void> {
    await this.request('SetCurrentSceneTransition', { transitionName });
  }

  /**
   * Creates or updates a single 1920x1080 60fps OpenVolley Browser Source and attaches
   * it to every selected scene (sharing one connection via CreateSceneItem).
   */
  async setupBrowserSourceAcrossScenes(
    sourceName: string,
    overlayUrl: string,
    sceneNames: string[]
  ): Promise<{ created: boolean; attachedCount: number }> {
    const inputSettings = {
      url: overlayUrl,
      width: 1920,
      height: 1080,
      fps_custom: true,
      fps: 60,
      shutdown: false,
      restart_when_active: false,
    };

    const { inputs } = (await this.request('GetInputList', {
      inputKind: 'browser_source',
    })) as { inputs?: Array<{ inputName: string }> };

    const exists = Array.isArray(inputs) && inputs.some((i) => i.inputName === sourceName);
    let created = false;
    let attachedCount = 0;

    if (exists) {
      await this.request('SetInputSettings', {
        inputName: sourceName,
        inputSettings,
        overlay: true,
      });
    } else if (sceneNames.length > 0) {
      await this.request('CreateInput', {
        sceneName: sceneNames[0],
        inputName: sourceName,
        inputKind: 'browser_source',
        inputSettings,
        sceneItemEnabled: true,
      });
      created = true;
      attachedCount++;
    }

    for (const sName of sceneNames) {
      const listRes = (await this.request('GetSceneItemList', {
        sceneName: sName,
      })) as { sceneItems?: Array<{ sourceName: string }> };
      const alreadyInScene =
        Array.isArray(listRes.sceneItems) &&
        listRes.sceneItems.some((item) => item.sourceName === sourceName);

      if (!alreadyInScene) {
        await this.request('CreateSceneItem', {
          sceneName: sName,
          sourceName,
          sceneItemEnabled: true,
        });
        attachedCount++;
      }
    }

    return { created, attachedCount };
  }
}
