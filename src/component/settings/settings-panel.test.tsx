import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPanel, useAccountDisplayNameField } from "@/component/settings/settings-panel";
import * as api from "@/lib/api";
import { useSettingsStore } from "@/store/settings-store";
import { useUiStore } from "@/store/ui-store";

// D-8: 通常ユーザーには法的文章＋ログアウトのみ。技術設定は開発者フラグ(ou_dev)の裏に隠す。
describe("SettingsPanel", () => {
  afterEach(() => {
    cleanup();
    useUiStore.getState().closeSettings();
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    localStorage.removeItem("ou_dev");
  });

  const open = (dev = false): QueryClient => {
    if (dev) localStorage.setItem("ou_dev", "1");
    else localStorage.removeItem("ou_dev");
    useUiStore.getState().openSettings();
    // ログアウトの現在ユーザー取得(useQuery)のため QueryClient で包む
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SettingsPanel />
      </QueryClientProvider>,
    );
    return client;
  };

  it("既定では法的文章とログアウトのみの最小構成を表示する", () => {
    open();
    expect(screen.getByText("設定")).toBeInTheDocument();
    expect(screen.getByText("法的文章")).toBeInTheDocument();
    expect(screen.getByText("ログアウト")).toBeInTheDocument();
    expect(screen.getByText("燈 ・ 1.0.0")).toBeInTheDocument();
  });

  it("既定では技術設定グループを表示しない", () => {
    open();
    expect(screen.queryByText("写真")).toBeNull();
    expect(screen.queryByText("ことばと声")).toBeNull();
    expect(screen.queryByText("呼ばれかた・記憶")).toBeNull();
  });

  // #1224/#1228: アカウント単位の名前は devMode の裏に隠さん。技術設定とは別に
  // 常時露出させんと、局長以外の誰も辿り着けん入力欄になる（敵対レビュー #1236 指摘）。
  it("既定でもアカウント単位の「あなたのこと」グループと名前入力欄を表示する", () => {
    open();
    expect(screen.getByText("あなたのこと")).toBeInTheDocument();
    const input = screen.getByLabelText("あなたの名前");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("maxlength", "24");
  });

  it("キャラ一覧（今夜の相手 / まだ決めない）を設定から表示しない", () => {
    open(true);
    expect(screen.queryByText("今夜の相手")).toBeNull();
    expect(screen.queryByText("まだ決めない")).toBeNull();
    expect(screen.queryByText("キャラクター")).toBeNull();
  });

  it("開発者フラグ時は三つの技術設定グループを表示する", () => {
    open(true);
    expect(screen.getByText("写真")).toBeInTheDocument();
    expect(screen.getByText("ことばと声")).toBeInTheDocument();
    expect(screen.getByText("呼ばれかた・記憶")).toBeInTheDocument();
  });

  it("開発者フラグ時は既存設定ストアに対応する主要コントロールを表示する", () => {
    open(true);
    expect(screen.getByText("写真が、ひとりでにとどく")).toBeInTheDocument();
    expect(screen.getByText("ことばの量")).toBeInTheDocument();
    expect(screen.getByText("呼ばれかた")).toBeInTheDocument();
    expect(screen.getByLabelText("彼女たちに、伝えておくこと")).toBeInTheDocument();
    expect(screen.getByText("今夜を、はじめからやりなおす")).toBeInTheDocument();
  });

  // #1224/#1228: アカウント単位の表示名。既存のキャラ依存「呼ばれかた」とは別の入力欄。
  // 常時露出なので devMode でも消えずに残ることだけをここで確認する。
  // 敵対レビュー・18巡目: Escape やオーバーレイで閉じると入力欄に focus が残ったまま
  // 消えるため blur が飛ばず、commitDisplayName が走らんまま入力が失われていた。
  it("シートを閉じる操作でも未保存の表示名を保存する", async () => {
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    });
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockResolvedValue("コウスケ");
    open();
    const input = await screen.findByLabelText("あなたの名前");
    fireEvent.change(input, { target: { value: "コウスケ" } });
    // blur を発生させずに Escape で閉じる（Radix の onOpenChange 経由）
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith("コウスケ"));
  });

  // サロゲートペアを割らずに24 UTF-16単位以内へ収める（サーバの zod .max(24) と揃える）。
  it("絵文字を含む長い入力でもサロゲートペアを割らない", async () => {
    vi.spyOn(api, "fetchCurrentUser").mockResolvedValue({
      email: "x@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    });
    open();
    const input = await screen.findByLabelText("あなたの名前");
    fireEvent.change(input, { target: { value: "a".repeat(23) + "\u{1F600}" } });
    const value = (input as HTMLInputElement).value;
    expect(value.length).toBeLessThanOrEqual(24);
    expect(
      [...value].some(
        (c) => c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff,
      ),
    ).toBe(false);
  });

  it("開発者フラグ時もアカウント単位の名前入力欄が消えない", () => {
    open(true);
    const input = screen.getByLabelText("あなたの名前");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("maxlength", "24");
    expect(input).toHaveValue("");
  });

  it("名前入力は24文字を超えて入力できない", () => {
    open(true);
    const input = screen.getByLabelText("あなたの名前");
    fireEvent.change(input, { target: { value: "あ".repeat(30) } });
    expect(input).toHaveValue("あ".repeat(24));
  });

  // 敵対レビュー #1236 指摘（2巡目）: クライアント側で古い応答を握り潰すだけでは、
  // 古いリクエスト自体がサーバへ後から届いて先に書き込まれてしまう余地が残る
  // （リロードすると古い値に戻る）。2件目の送信が1件目の完了を待ってから
  // 実際にネットワークへ出ることを確認する。
  it("連続保存は1件ずつ完了を待ってから次を送信する（送信順=到達順を保証）", async () => {
    const order: string[] = [];
    const pending = new Map<string, (value: string | null) => void>();
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockImplementation(
      (value: string) =>
        new Promise<string | null>((resolve) => {
          order.push(value);
          pending.set(value, resolve);
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const meData: api.MeResponse = {
      email: "test@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    };
    client.setQueryData(["me"], meData);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAccountDisplayNameField(meData, client), { wrapper });

    act(() => result.current.saveDisplayName("Alice"));
    act(() => result.current.saveDisplayName("Bob"));

    await waitFor(() => expect(order).toEqual(["Alice"]));
    // "Alice"がまだ解決していない間は"Bob"のリクエストは送られていない
    expect(pending.has("Bob")).toBe(false);

    await act(async () => pending.get("Alice")?.("Alice"));
    await waitFor(() => expect(order).toEqual(["Alice", "Bob"]));

    updateSpy.mockRestore();
  });

  // #1224/#1228 敵対レビュー #1236 指摘: 連続blurで2回保存を送った時、最終的にキャッシュ・
  // 入力欄の両方が最後に送った値に一致することを確認する。送信自体は1件ずつ直列化される
  // （上のテスト参照）ため、ここでは "Alice" → "Bob" の順で完了させ、最終状態を検証する。
  it("連続保存の最終状態はキャッシュ・入力欄とも最後に送った値になる", async () => {
    const pending = new Map<string, (value: string | null) => void>();
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockImplementation(
      (value: string) =>
        new Promise<string | null>((resolve) => {
          pending.set(value, resolve);
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const meData: api.MeResponse = {
      email: "test@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    };
    client.setQueryData(["me"], meData);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAccountDisplayNameField(meData, client), { wrapper });

    act(() => result.current.setDisplayNameInput("Alice"));
    act(() => result.current.saveDisplayName("Alice"));
    act(() => result.current.setDisplayNameInput("Bob"));
    act(() => result.current.saveDisplayName("Bob"));

    await waitFor(() => expect(pending.has("Alice")).toBe(true));
    expect(pending.has("Bob")).toBe(false);

    await act(async () => pending.get("Alice")?.("Alice"));
    await waitFor(() => expect(pending.has("Bob")).toBe(true));
    await act(async () => pending.get("Bob")?.("Bob"));

    await waitFor(() => expect(result.current.displayNameInput).toBe("Bob"));
    expect(client.getQueryData<api.MeResponse>(["me"])?.displayName).toBe("Bob");

    updateSpy.mockRestore();
  });

  // 敵対レビュー #1236 指摘: 保存成功のonSuccessがqueryClient.setQueryData(["me"], ...)で
  // 書き込むと、実際のuseQueryの`data`参照が変わる。旧実装は me!==syncedMe（参照比較）で
  // 毎回同期し直しとったため、「保存中に次の編集を始めた」だけで自分自身の保存成功が
  // 未送信の新しい編集を巻き戻していた。useQuery経由でmeを取得する実際の配線を再現して確認する。
  it("保存が成功した直後でも、まだ送っていない新しい編集を巻き戻さない", async () => {
    const pending = new Map<string, (value: string | null) => void>();
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockImplementation(
      (value: string) =>
        new Promise<string | null>((resolve) => {
          pending.set(value, resolve);
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["me"], {
      email: "test@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const useTestField = () => {
      const { data: me } = useQuery<api.MeResponse>({
        queryKey: ["me"],
        queryFn: () => Promise.reject(new Error("not used in this test")),
        staleTime: 5 * 60 * 1000,
      });
      return useAccountDisplayNameField(me, client);
    };
    const { result } = renderHook(useTestField, { wrapper });

    // "Name1"を保存する（応答はまだ届かない）
    act(() => result.current.setDisplayNameInput("Name1"));
    act(() => result.current.saveDisplayName("Name1"));

    // mutate() の実際の呼び出しは非同期にスケジュールされるので、
    // 呼ばれるまで待ってから次へ進む（待たずに進むと resolve が空振りし、
    // このテストは何も検証せず素通りしてしまう）。
    await waitFor(() => expect(pending.has("Name1")).toBe(true));

    // 保存中に、まだ送っていない新しい編集を始める
    act(() => result.current.setDisplayNameInput("Name2"));

    // "Name1"の保存が成功して返ってくる
    await act(async () => pending.get("Name1")?.("Name1"));

    // onSuccessのqueryClient.setQueryDataがuseQueryのmeを新しい参照へ差し替え、
    // それを検知した再レンダーが走るまでには複数tick挟むことがあるため、
    // キャッシュへの反映（確定的に観測できる中間状態）を先に待つ。
    await waitFor(() => {
      expect(client.getQueryData<api.MeResponse>(["me"])?.displayName).toBe("Name1");
    });
    // その後さらに実時間で猶予を与え、旧実装のバグ（me参照の変化を検知して
    // displayNameInputを巻き戻す再同期）が起きるとしたらこの間に起きているはず。
    await act(async () => {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    });

    // 未送信の"Name2"がそのまま残っていること（巻き戻されない）
    expect(result.current.displayNameInput).toBe("Name2");

    updateSpy.mockRestore();
  });

  // 敵対レビュー #1236 指摘（4巡目）: 初回同期ガード(syncedMe===undefined)は「一度も
  // syncしてない」だけを見ており、ユーザーが編集済みかどうかは見ていなかった。
  // /api/me がまだ読み込み中の間に入力欄へ打ち始めた編集を、初回応答到着で巻き戻していた。
  it("/api/meが読み込み中に入力した編集を、初回応答到着で巻き戻さない", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook<
      ReturnType<typeof useAccountDisplayNameField>,
      { me: api.MeResponse | undefined }
    >(({ me }) => useAccountDisplayNameField(me, client), {
      wrapper,
      initialProps: { me: undefined },
    });

    // /api/me がまだ届いていない間に、ユーザーが名前を打ち始める
    act(() => result.current.setDisplayNameInput("タイプ中"));
    expect(result.current.displayNameInput).toBe("タイプ中");

    // ここで初回の /api/me 応答が届く（サーバー上の登録済み表示名は別の値）
    rerender({
      me: {
        email: "test@example.com",
        logoutUrl: null,
        isLocal: true,
        displayName: "サーバー登録名",
      },
    });

    // 入力中の編集が消し飛ばず残っていること
    expect(result.current.displayNameInput).toBe("タイプ中");
  });

  // 敵対レビュー #1236 指摘（4巡目）: 連続blur A→Bで、Aの保存がサーバーへ成功した直後に
  // Bの保存が失敗すると、Aのonsuccessはlatestとの不一致ガードで握り潰され、キャッシュは
  // pre-A値のまま止まる。D1には実際にAの値が書き込まれとるのに、キャッシュだけ乖離した
  // まま放置されていた。失敗時にキャッシュを再取得させ、サーバー実値へ収束させる。
  it("連続保存でAが成功した直後にBが失敗すると、キャッシュを再取得して収束させる", async () => {
    const pending = new Map<
      string,
      { resolve: (value: string | null) => void; reject: (error: Error) => void }
    >();
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockImplementation(
      (value: string) =>
        new Promise<string | null>((resolve, reject) => {
          pending.set(value, { resolve, reject });
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const meData: api.MeResponse = {
      email: "test@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    };
    client.setQueryData(["me"], meData);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAccountDisplayNameField(meData, client), { wrapper });

    act(() => result.current.saveDisplayName("A"));
    act(() => result.current.saveDisplayName("B"));

    await waitFor(() => expect(pending.has("A")).toBe(true));
    await act(async () => pending.get("A")?.resolve("A"));

    await waitFor(() => expect(pending.has("B")).toBe(true));
    await act(async () => pending.get("B")?.reject(new Error("network error")));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["me"] });
    });

    updateSpy.mockRestore();
  });

  // 敵対レビュー #1236 指摘・7巡目: 保存が失敗した後、latestSubmittedRefに失敗した値が
  // 残ったままだと、commitDisplayNameのbaseline判定が「その値は既に送信済み」と誤認し、
  // 同じ値へ戻して再blurする「リトライ」が変更なしとしてスキップされてしまっていた。
  it("保存失敗後、同じ値でのリトライ（再blur）が送信される", async () => {
    const pending = new Map<
      string,
      { resolve: (value: string | null) => void; reject: (error: Error) => void }
    >();
    let callCount = 0;
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockImplementation(
      (value: string) =>
        new Promise<string | null>((resolve, reject) => {
          callCount += 1;
          pending.set(`${value}-${callCount}`, { resolve, reject });
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const meData: api.MeResponse = {
      email: "test@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    };
    client.setQueryData(["me"], meData);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAccountDisplayNameField(meData, client), { wrapper });

    act(() => result.current.commitDisplayName("A"));
    await waitFor(() => expect(pending.has("A-1")).toBe(true));
    await act(async () => pending.get("A-1")?.reject(new Error("network error")));

    // 値を変えずに再blur（=リトライ）。commitDisplayNameは"A"を既に送信済みと誤認せず、
    // 再送するはず。
    act(() => result.current.commitDisplayName("A"));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));

    updateSpy.mockRestore();
  });

  // 敵対レビュー #1236 指摘・8巡目: 連続blur A→Bで、Aが失敗した直後にBが成功すると、
  // Aの失敗ハンドラが投げっぱなしにしていたinvalidateQueries（再取得）がBのonSuccessより
  // 後まで生き残り、Bが書いた正しい値をAの古い再取得結果で上書きしてしまう競合があった。
  // Bの送信自体がAの再取得の完了を待つようになったことを、送信順（updateSpyの呼び出し順）で
  // 確認する。
  it("Aの保存失敗後の再取得が完了するまで、続くBの送信は待つ", async () => {
    const pending = new Map<
      string,
      { resolve: (value: string | null) => void; reject: (error: Error) => void }
    >();
    let callCount = 0;
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockImplementation(
      (value: string) =>
        new Promise<string | null>((resolve, reject) => {
          callCount += 1;
          pending.set(`${value}-${callCount}`, { resolve, reject });
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const meData: api.MeResponse = {
      email: "test@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    };
    client.setQueryData(["me"], meData);

    let resolveInvalidate: (() => void) | undefined;
    const invalidateSpy = vi.spyOn(client, "invalidateQueries").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveInvalidate = resolve;
        }),
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAccountDisplayNameField(meData, client), { wrapper });

    act(() => result.current.commitDisplayName("A"));
    await waitFor(() => expect(pending.has("A-1")).toBe(true));
    await act(async () => pending.get("A-1")?.reject(new Error("network error")));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled());

    act(() => result.current.commitDisplayName("B"));

    // Aの再取得がまだ未解決の間は、Bの送信は始まらない。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pending.has("B-2")).toBe(false);

    resolveInvalidate?.();

    await waitFor(() => expect(pending.has("B-2")).toBe(true));

    invalidateSpy.mockRestore();
    updateSpy.mockRestore();
  });

  // 敵対レビュー #1236 指摘・9巡目: A→B→Aと値を戻して連続送信した直後にAが失敗すると、
  // 送信中のB・Aはまだキューで待っている段階で3回目のsaveDisplayNameが同期的に
  // latestSubmittedRef.currentへ"A"（1回目と同じ文字列）を書いてしまう。失敗ハンドラは
  // 値の文字列一致だけでlatestSubmittedRefを見て「これは最新の送信の失敗だ」と誤認し、
  // まだキューにいるB・Aの送信を守るためのrefをnullへ巻き戻してしまう。結果、後続の
  // B・Aが成功してもonSuccessが「もう最新じゃない」と誤判定して握り潰し、キャッシュは
  // 失敗直後のinvalidateQueriesが取得した古い値のまま、D1だけ最終値"A"で食い違う。
  it("A→B→Aで1回目のAが失敗しても、最終的にキャッシュがD1と同じ最終値へ収束する", async () => {
    const pending = new Map<
      string,
      { resolve: (value: string | null) => void; reject: (error: Error) => void }
    >();
    let callCount = 0;
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockImplementation(
      (value: string) =>
        new Promise<string | null>((resolve, reject) => {
          callCount += 1;
          pending.set(`${value}-${callCount}`, { resolve, reject });
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const meData: api.MeResponse = {
      email: "test@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: null,
    };
    client.setQueryData(["me"], meData);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAccountDisplayNameField(meData, client), { wrapper });

    act(() => result.current.saveDisplayName("A"));
    act(() => result.current.saveDisplayName("B"));
    act(() => result.current.saveDisplayName("A"));

    await waitFor(() => expect(pending.has("A-1")).toBe(true));
    await act(async () => pending.get("A-1")?.reject(new Error("network error")));

    await waitFor(() => expect(pending.has("B-2")).toBe(true));
    await act(async () => pending.get("B-2")?.resolve("B"));

    await waitFor(() => expect(pending.has("A-3")).toBe(true));
    await act(async () => pending.get("A-3")?.resolve("A"));

    await waitFor(() => {
      expect(client.getQueryData<api.MeResponse>(["me"])?.displayName).toBe("A");
    });

    updateSpy.mockRestore();
  });

  // 敵対レビュー #1236 指摘・11巡目: 画面を開いた直後の初回 useQuery(["me"]) がまだ
  // in-flight（＝キャッシュに元データが一度も無い）状態で保存を先に終えると、
  // setQueryDataのマージは「prevが無ければ何もしない」ため保存結果がキャッシュへ
  // 反映されない。その後、開いた直後からin-flightだった初回取得が保存前の古い値
  // (displayName: null)で解決すると、それがそのままキャッシュになってしまう。
  it("初回取得がin-flightのまま保存が先に終わっても、最終的に保存した値へ揃う", async () => {
    const fetchMeCalls: { resolve: (value: api.MeResponse) => void }[] = [];
    const fetchSpy = vi.spyOn(api, "fetchCurrentUser").mockImplementation(
      () =>
        new Promise<api.MeResponse>((resolve) => {
          fetchMeCalls.push({ resolve });
        }),
    );
    const updateSpy = vi
      .spyOn(api, "updateMyDisplayName")
      .mockImplementation(() => Promise.resolve("New"));

    const client = open();

    await waitFor(() => expect(fetchMeCalls.length).toBeGreaterThanOrEqual(1));

    const input = screen.getByLabelText("あなたの名前");
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.blur(input);

    await waitFor(() => expect(updateSpy).toHaveBeenCalled());
    // 保存成功のonSuccessが、in-flightだった初回取得をキャンセルしたうえで
    // （まだキャッシュに元データが無いので）取り直しの2回目取得を発行する。
    await waitFor(() => expect(fetchMeCalls.length).toBeGreaterThanOrEqual(2));

    // 開いた直後からin-flightだった1回目（キャンセル済みのはず）が、保存前の
    // 古い値(displayName: null)で遅れて解決する。
    await act(async () => {
      fetchMeCalls[0]?.resolve({
        email: "test@example.com",
        logoutUrl: null,
        isLocal: true,
        displayName: null,
      });
    });

    // 取り直しの2回目取得が、保存が反映済みのD1から正しい値で解決する。
    await act(async () => {
      fetchMeCalls[1]?.resolve({
        email: "test@example.com",
        logoutUrl: null,
        isLocal: true,
        displayName: "New",
      });
    });

    await waitFor(() => {
      expect(client.getQueryData<api.MeResponse>(["me"])?.displayName).toBe("New");
    });

    fetchSpy.mockRestore();
    updateSpy.mockRestore();
  });

  // 敵対レビュー #1236 指摘・6巡目: 保存値="Old"の状態でAへblur（送信中）してから、
  // 応答が届く前に元の"Old"へ戻してblurすると、旧実装は「変更なし」の判定を
  // me.displayName（まだ"Old"のまま）とだけ比べていたため、送信中のAとの差分を
  // 見落として2回目の送信をスキップしていた。Aは後で成功してキャッシュへ"A"を書き込むため、
  // ユーザーが最後に見せた「元に戻す」編集がサーバーへ送られず、キャッシュ・D1とだけ乖離する。
  it("送信中の値へ戻すblurは、pendingの値と比較して再送する", async () => {
    const pending = new Map<
      string,
      { resolve: (value: string | null) => void; reject: (error: Error) => void }
    >();
    const updateSpy = vi.spyOn(api, "updateMyDisplayName").mockImplementation(
      (value: string) =>
        new Promise<string | null>((resolve, reject) => {
          pending.set(value, { resolve, reject });
        }),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const meData: api.MeResponse = {
      email: "test@example.com",
      logoutUrl: null,
      isLocal: true,
      displayName: "Old",
    };
    client.setQueryData(["me"], meData);
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useAccountDisplayNameField(meData, client), { wrapper });

    act(() => result.current.commitDisplayName("A"));
    await waitFor(() => expect(pending.has("A")).toBe(true));

    // Aの応答がまだ届いてへん間に、元の"Old"へ戻してblur。
    // saveDisplayNameは直列チェーン(pendingChainRef)なので、Old側の実際の送信はAの
    // 応答が届いてから始まる。ここではlatestSubmittedRef基準の「送信対象になるか」の
    // 判定だけを見たいので、Aを即座に解決してチェーンを進める。
    act(() => result.current.commitDisplayName("Old"));
    await act(async () => pending.get("A")?.resolve("A"));

    await waitFor(() => expect(pending.has("Old")).toBe(true));
    await act(async () => pending.get("Old")?.resolve("Old"));

    expect(updateSpy.mock.calls.some((call) => call[0] === "Old")).toBe(true);

    updateSpy.mockRestore();
  });

  it("保存済みの自由入力の呼ばれかたをそのまま表示する", () => {
    useSettingsStore.getState().setUserRole("先輩");
    open(true);
    expect(screen.getByText("先輩 ›")).toBeInTheDocument();
  });

  it("リセット時に永続化だけでなく画面上の設定も初期値へ戻す", () => {
    useSettingsStore.getState().setUserRole("先輩");
    useSettingsStore.getState().setResponseLength("very_long");
    open(true);

    fireEvent.click(screen.getByText("今夜を、はじめからやりなおす"));

    expect(screen.getByText("あなた ›")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ふつう" })).toHaveAttribute("aria-pressed", "true");
    expect(useSettingsStore.getState().userRole).toBe("");
  });

  it("選択式のセグメントが支援技術へ選択状態を公開する", () => {
    open(true);
    expect(screen.getByRole("button", { name: "画面ごと" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // #1459: 履歴一覧には「消しても、彼女の記憶は残ります」と書いてあるのに、
  // 消す操作がどこにも無かった。全消しはここが入口。
  describe("履歴をすべて消す", () => {
    it("一段目では消えん。「やめる」で必ず戻れる", () => {
      const spy = vi.spyOn(api, "deleteAllConversations").mockResolvedValue(undefined);
      open(true);

      fireEvent.click(screen.getByText("履歴をすべて消す"));
      expect(spy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("button", { name: "やめる" }));
      expect(spy).not.toHaveBeenCalled();
      expect(screen.getByText("履歴をすべて消す")).toBeInTheDocument();
      spy.mockRestore();
    });

    it("「消す」で初めて全削除が走る", async () => {
      const spy = vi.spyOn(api, "deleteAllConversations").mockResolvedValue(undefined);
      open(true);

      fireEvent.click(screen.getByText("履歴をすべて消す"));
      fireEvent.click(screen.getByRole("button", { name: "消す" }));

      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      spy.mockRestore();
    });
  });
});
