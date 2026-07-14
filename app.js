const STORAGE_KEY = "longterm-pomodoro-state-v1";
const PLAN_VERSION = 2;

const els = {
  app: document.querySelector("#app"),
  headerTitle: document.querySelector("#headerTitle"),
  headerKicker: document.querySelector("#headerKicker"),
  backButton: document.querySelector("#backButton"),
  newGoalButton: document.querySelector("#newGoalButton"),
  goalDialog: document.querySelector("#goalDialog"),
  goalForm: document.querySelector("#goalForm"),
  reviseDialog: document.querySelector("#reviseDialog"),
  reviseForm: document.querySelector("#reviseForm"),
  dateDialog: document.querySelector("#dateDialog"),
  dateForm: document.querySelector("#dateForm"),
  tabs: [...document.querySelectorAll(".tab-button")],
};

let state = loadState();
let timerTick = null;

function createInitialState() {
  return {
    activeGoalId: null,
    goals: [],
    archivedGoals: [],
    view: "today",
    selectedHistoryId: null,
    timer: {
      goalId: null,
      taskId: null,
      totalSeconds: 25 * 60,
      secondsLeft: 25 * 60,
      running: false,
      taskTitle: "",
    },
  };
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed) return createInitialState();
    const next = { ...createInitialState(), ...parsed };
    next.timer = { ...createInitialState().timer, ...(parsed.timer || {}) };
    migrateState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return createInitialState();
  }
}

function migrateState(next) {
  next.goals.forEach((goal) => {
    if (goal.planVersion === PLAN_VERSION) return;
    Object.keys(goal.dailyPlans || {}).forEach((date) => {
      if (date < todayISO()) return;
      const phase = findPhaseForDate(goal, date);
      if (!phase) return;
      const doneTasks = goal.dailyPlans[date].tasks.filter((task) => task.done);
      const index = dateRange(phase.startDate, phase.endDate).indexOf(date);
      const freshTasks = tasksForDay(goal, phase, date, Math.max(0, index));
      goal.dailyPlans[date].tasks = [...doneTasks, ...freshTasks].slice(0, Math.max(doneTasks.length, freshTasks.length));
    });
    goal.planVersion = PLAN_VERSION;
  });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toISO(date) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(value, amount) {
  const date = typeof value === "string" ? toDate(value) : new Date(value);
  date.setDate(date.getDate() + amount);
  return toISO(date);
}

function daysBetween(start, end) {
  const ms = toDate(end) - toDate(start);
  return Math.floor(ms / 86400000) + 1;
}

function dateRange(start, end) {
  const total = Math.max(0, daysBetween(start, end));
  return Array.from({ length: total }, (_, index) => addDays(start, index));
}

function formatDate(value) {
  const date = toDate(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateLong(value) {
  const date = toDate(value);
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function todayISO() {
  return toISO(new Date());
}

function getActiveGoal() {
  return state.goals.find((goal) => goal.id === state.activeGoalId) || null;
}

function getGoalById(goalId) {
  return state.goals.find((goal) => goal.id === goalId) || null;
}

function getGoalFromAction(actionTarget) {
  const goalId = actionTarget.closest("[data-goal-id]")?.dataset.goalId || state.activeGoalId;
  return getGoalById(goalId);
}

function getAllGeneratedTasks(goal) {
  return Object.values(goal.dailyPlans).flatMap((day) => day.tasks);
}

function getGoalProgress(goal) {
  const tasks = getAllGeneratedTasks(goal);
  const done = tasks.filter((task) => task.done).length;
  return {
    done,
    total: tasks.length,
    percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

function getEffectiveStart(goal) {
  return goal.includeStart ? goal.startDate : addDays(goal.startDate, 1);
}

function getRemainingDays(goal) {
  const today = todayISO();
  if (today > goal.endDate) return 0;
  const start = today < getEffectiveStart(goal) ? getEffectiveStart(goal) : today;
  return Math.max(0, daysBetween(start, goal.endDate));
}

function currentPhase(goal) {
  const today = todayISO();
  const dated = goal.phases.find((phase) => today >= phase.startDate && today <= phase.endDate);
  if (dated) return dated;
  const next = goal.phases.find((phase) => today < phase.startDate);
  if (next) return next;
  return goal.phases[goal.phases.length - 1];
}

function findPhaseForDate(goal, date) {
  return goal.phases.find((phase) => date >= phase.startDate && date <= phase.endDate);
}

function detectGoalDomain(title) {
  const normalized = title.toLowerCase();
  if (/日语|英语|语言|n\d|雅思|托福|单词|听力|口语/.test(normalized)) return "learning";
  if (/健身|减脂|跑步|体重|训练|瑜伽|运动/.test(normalized)) return "fitness";
  if (/写作|小说|论文|文章|书|博客|创作/.test(normalized)) return "writing";
  if (/编程|代码|开发|app|网站|项目|产品/.test(normalized)) return "building";
  if (/考试|证书|考研|公考|复习/.test(normalized)) return "exam";
  return "general";
}

function makePhaseTitles(domain) {
  const titles = {
    learning: ["建立输入框架", "高频内容推进", "专项练习", "整合复习", "成果验收"],
    fitness: ["基线建立", "动作与节奏", "容量提升", "稳定巩固", "成果检测"],
    writing: ["素材和结构", "初稿推进", "重点章节", "修订打磨", "定稿交付"],
    building: ["需求和骨架", "核心功能", "体验完善", "验证修正", "发布收尾"],
    exam: ["考纲梳理", "知识推进", "题型训练", "错题回补", "模拟验收"],
    general: ["目标拆解", "稳定推进", "关键突破", "复盘修正", "收尾验收"],
  };
  return titles[domain];
}

function createGoalPlan(input) {
  const effectiveStart = input.includeStart ? input.startDate : addDays(input.startDate, 1);
  const totalDays = Math.max(1, daysBetween(effectiveStart, input.endDate));
  const phaseCount = Math.min(5, Math.max(2, Math.ceil(totalDays / 10)));
  const domain = detectGoalDomain(input.title);
  const phaseTitles = makePhaseTitles(domain);
  const phases = [];
  let cursor = effectiveStart;

  for (let index = 0; index < phaseCount; index += 1) {
    const remainingDays = daysBetween(cursor, input.endDate);
    const remainingPhases = phaseCount - index;
    const length = index === phaseCount - 1 ? remainingDays : Math.max(1, Math.floor(remainingDays / remainingPhases));
    const phaseEnd = index === phaseCount - 1 ? input.endDate : addDays(cursor, length - 1);
    phases.push({
      id: uid("phase"),
      title: phaseTitles[index],
      startDate: cursor,
      endDate: phaseEnd,
      outcome: buildOutcome(domain, phaseTitles[index], input.title),
      expanded: index === 0,
    });
    cursor = addDays(phaseEnd, 1);
  }

  const goal = {
    id: uid("goal"),
    title: input.title,
    startDate: input.startDate,
    endDate: input.endDate,
    includeStart: input.includeStart,
    minutes: Number(input.minutes),
    intensity: input.intensity,
    preference: input.preference,
    status: "active",
    createdAt: new Date().toISOString(),
    completedAt: null,
    abandonedAt: null,
    revisions: [],
    planVersion: PLAN_VERSION,
    phases,
    dailyPlans: {},
    focusSessions: [],
  };

  generateDailyPlansForPhase(goal, phases[0].id, "初始生成");
  return goal;
}

function buildOutcome(domain, phaseTitle, goalTitle) {
  const outcomes = {
    learning: `围绕「${goalTitle}」形成可复用的学习笔记、练习记录和一轮复盘。`,
    fitness: "记录基线、完成稳定训练，并保留身体反馈，避免只追求强度。",
    writing: "把模糊想法落到可检查的段落、结构或稿件版本上。",
    building: "交付可运行的小版本，并记录剩余问题和下一步取舍。",
    exam: "把知识点、题型和错题整理成下一阶段可以直接使用的材料。",
    general: "产出一个可验证的小成果，并确认下一阶段是否需要调整方向。",
  };
  return `${phaseTitle}：${outcomes[domain]}`;
}

function goalSubject(goalTitle) {
  return goalTitle
    .replace(/^\s*\d+\s*(天|周|个月|年)?\s*(内|之内)?\s*/, "")
    .replace(/^(完成|学会|掌握|达成|实现|做完|开始|坚持|优化)/, "")
    .replace(/(第一轮|一轮|基础学习|计划|目标)$/g, "")
    .replace(/\s+/g, " ")
    .trim() || goalTitle;
}

function measurableUnit(domain) {
  const units = {
    learning: "3 个关键词、1 条例句、1 个疑问",
    fitness: "训练项目、组数/时长、体感评分",
    writing: "150-300 字正文、1 条修改注释",
    building: "1 个可点击行为、1 条验证记录",
    exam: "10 道题、错因标签、2 个回忆点",
    general: "1 个可交付物、3 条验收标准",
  };
  return units[domain];
}

function tasksForDay(goal, phase, date, index) {
  const domain = detectGoalDomain(goal.title);
  const weekday = toDate(date).getDay();
  const isWeekend = weekday === 0 || weekday === 6;
  const baseCount = goal.intensity === "sprint" ? 4 : goal.intensity === "gentle" ? 2 : 3;
  const count = isWeekend && /周末轻|周末少|周末休/.test(goal.preference) ? Math.max(1, baseCount - 1) : baseCount;
  const minutes = Math.max(10, Math.round(goal.minutes / count / 5) * 5);
  const subject = goalSubject(goal.title);
  const phaseLabel = phase.title;
  const unit = measurableUnit(domain);
  const taskSets = {
    learning: [
      [`学习「${subject}」的一个小节`, `围绕「${phaseLabel}」完成 ${minutes} 分钟输入，留下 ${unit}。`],
      [`完成「${subject}」专项练习`, "做 10-15 分钟练习，给每个错误标注原因：不熟、没看懂、速度慢。"],
      [`闭卷回忆「${subject}」`, "不看资料写出今天最重要的 3 点，再回看资料补 1 处遗漏。"],
      [`整理「${subject}」错点清单`, "把今天卡住的内容写成 3 个明天可复习的问题。"],
    ],
    fitness: [
      [`完成「${subject}」主训练`, `按「${phaseLabel}」安排完成 ${minutes} 分钟训练，记录 ${unit}。`],
      [`记录「${subject}」身体反馈`, "写下训练前后体感、疼痛点和明天是否需要降强度。"],
      [`做「${subject}」恢复拉伸`, "完成 3 个相关部位拉伸，每个动作至少 40 秒。"],
      [`检查「${subject}」饮食影响`, "记录今天最影响目标的一餐，并写出明天 1 个替代选择。"],
    ],
    writing: [
      [`写出「${subject}」一段可改内容`, `围绕「${phaseLabel}」产出 ${unit}，不要停在构思。`],
      [`补齐「${subject}」素材`, "新增 3 条可用素材：例子、论据、场景、引用或人物动作。"],
      [`修订「${subject}」一个问题`, "只改一类问题：结构、表达、证据或节奏，并记录修改前后差异。"],
      [`留下「${subject}」续写入口`, "写下明天开头第一句或下一段提纲，避免明天重新热机。"],
    ],
    building: [
      [`实现「${subject}」一个可见功能`, `围绕「${phaseLabel}」交付 ${unit}，哪怕版本很小。`],
      [`验证「${subject}」核心路径`, "从用户入口手动跑 1 遍，记录 1 个通过点和 1 个阻塞点。"],
      [`修正「${subject}」一个体验问题`, "处理一个会影响使用的按钮、文案、状态或布局问题。"],
      [`整理「${subject}」下一步`, "把未完成点写成 2 条明天能直接开始的任务。"],
    ],
    exam: [
      [`学习「${subject}」一组考点`, `围绕「${phaseLabel}」完成 ${unit}，不要只划线。`],
      [`完成「${subject}」限时题`, "做 10 道题或 15 分钟训练，立刻核对错因。"],
      [`整理「${subject}」错题`, "把错因归类到知识缺口、审题偏差、速度或记忆不牢。"],
      [`闭卷回忆「${subject}」`, "用 5 分钟写出今天最重要的 2 个考点和 1 个易错点。"],
    ],
    general: [
      [`定义「${subject}」今日交付物`, `围绕「${phaseLabel}」写清 ${unit}，并完成其中最小的一项。`],
      [`完成「${subject}」一件可检查产出`, "产出一个文件、清单、草稿、记录或截图，结束时能被自己检查。"],
      [`排除「${subject}」一个阻塞点`, "写出当前最大卡点，选择一个 15 分钟内能验证的解决动作并执行。"],
      [`准备「${subject}」明天入口`, "留下明天第一步：打开哪个资料、改哪一段、做哪一组或联系谁。"],
    ],
  };
  const set = taskSets[domain];
  const tasks = Array.from({ length: count }, (_, taskIndex) => {
    const template = set[(index + taskIndex) % set.length];
    return {
      id: uid("task"),
      title: template[0],
      detail: `${phase.title} · ${template[1]}`,
      minutes,
      done: false,
      completedAt: null,
    };
  });

  if ((index + 1) % 5 === 0) {
    tasks[tasks.length - 1] = {
      id: uid("task"),
      title: "轻复盘和校准",
      detail: "检查本阶段产出，删除不必要的负担，确认下一步仍然合理。",
      minutes,
      done: false,
      completedAt: null,
    };
  }

  return tasks;
}

function generateDailyPlansForPhase(goal, phaseId, reason) {
  const phase = goal.phases.find((item) => item.id === phaseId);
  if (!phase) return;
  phase.expanded = true;
  dateRange(phase.startDate, phase.endDate).forEach((date, index) => {
    if (goal.dailyPlans[date]) return;
    goal.dailyPlans[date] = {
      date,
      phaseId,
      note: reason,
      tasks: tasksForDay(goal, phase, date, index),
    };
  });
}

function reviseFuturePlans(goal, feedback) {
  const today = todayISO();
  const revisedDates = Object.keys(goal.dailyPlans).filter((date) => date >= today);
  revisedDates.forEach((date) => {
    const phase = findPhaseForDate(goal, date);
    if (!phase) return;
    const index = dateRange(phase.startDate, phase.endDate).indexOf(date);
    const existingDone = goal.dailyPlans[date].tasks.filter((task) => task.done);
    const newTasks = tasksForDay(goal, phase, date, Math.max(0, index)).map((task) => ({
      ...task,
      detail: `${task.detail} 调整依据：${feedback || "降低负担，保留核心动作。"}`,
    }));
    goal.dailyPlans[date].tasks = [...existingDone, ...newTasks].slice(0, Math.max(existingDone.length, newTasks.length));
    goal.dailyPlans[date].note = feedback || "重新安排后续计划";
  });
  goal.revisions.push({
    id: uid("revision"),
    at: new Date().toISOString(),
    feedback: feedback || "重新安排后续计划",
  });
  goal.planVersion = PLAN_VERSION;
}

function extendOrShrinkGoal(goal, newEndDate) {
  if (newEndDate < getEffectiveStart(goal)) {
    toast("结束日期不能早于有效开始日期");
    return false;
  }
  goal.endDate = newEndDate;
  const oldPhases = goal.phases;
  const input = {
    title: goal.title,
    startDate: goal.startDate,
    endDate: newEndDate,
    includeStart: goal.includeStart,
    minutes: goal.minutes,
    intensity: goal.intensity,
    preference: goal.preference,
  };
  const regenerated = createGoalPlan(input);
  const today = todayISO();
  goal.phases = regenerated.phases.map((phase, index) => ({
    ...phase,
    expanded: oldPhases[index]?.expanded || index === 0,
  }));
  Object.keys(goal.dailyPlans).forEach((date) => {
    if (date > newEndDate) delete goal.dailyPlans[date];
  });
  goal.phases.filter((phase) => phase.expanded || (today >= phase.startDate && today <= phase.endDate)).forEach((phase) => {
    generateDailyPlansForPhase(goal, phase.id, "调整截止日后重排");
  });
  goal.planVersion = PLAN_VERSION;
  goal.revisions.push({
    id: uid("revision"),
    at: new Date().toISOString(),
    feedback: `截止日调整为 ${formatDateLong(newEndDate)}`,
  });
  return true;
}

function archiveGoal(goal, status) {
  goal.status = status;
  goal.completedAt = status === "completed" ? new Date().toISOString() : goal.completedAt;
  goal.abandonedAt = status === "abandoned" ? new Date().toISOString() : goal.abandonedAt;
  state.goals = state.goals.filter((item) => item.id !== goal.id);
  state.archivedGoals.unshift(goal);
  state.activeGoalId = state.goals[0]?.id || null;
  state.view = "history";
  state.selectedHistoryId = goal.id;
  saveState();
  render();
}

function ensureTodayPlan(goal) {
  if (!goal) return;
  const today = todayISO();
  if (today < getEffectiveStart(goal) || today > goal.endDate) return;
  if (goal.dailyPlans[today]) return;
  const phase = findPhaseForDate(goal, today) || currentPhase(goal);
  generateDailyPlansForPhase(goal, phase.id, "进入本阶段时细化");
}

function render() {
  if (state.goals.length && !getActiveGoal()) {
    state.activeGoalId = state.goals[0].id;
    saveState();
  }
  const goal = getActiveGoal();
  ensureTimer();
  updateHeader(goal);
  updateTabs();

  if (!state.goals.length && state.view !== "history") {
    renderEmpty();
    return;
  }

  if (state.view === "today") renderToday();
  if (state.view === "roadmap") renderRoadmap(goal);
  if (state.view === "focus") renderFocus(goal);
  if (state.view === "history") renderHistory();
}

function updateHeader(goal) {
  const titles = {
    today: "今天",
    roadmap: "路线",
    focus: "专注",
    history: "历史",
  };
  els.headerTitle.textContent = state.selectedHistoryId ? "目标档案" : titles[state.view];
  els.headerKicker.textContent = state.view === "today" && state.goals.length > 1 ? `${state.goals.length} 个进行中计划` : goal ? goal.title : "长期主义番茄钟";
  els.backButton.style.visibility = state.selectedHistoryId ? "visible" : "hidden";
}

function updateTabs() {
  els.tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === state.view && !state.selectedHistoryId);
  });
}

function renderEmpty() {
  els.app.innerHTML = `
    <section class="empty-state">
      <div>
        <p class="eyebrow">从一个长期目标开始</p>
        <h2>先定方向，再让每天变得具体。</h2>
      </div>
      <p>输入目标和日期范围，系统会生成阶段路线图，只细化当前阶段，避免把几个月后的每天都提前写死。</p>
      <button class="primary-button" data-action="open-goal">
        ${icon("spark")}
        新建长期目标
      </button>
    </section>
  `;
}

function renderGoalHero(goal) {
  const progress = getGoalProgress(goal);
  const totalDays = daysBetween(getEffectiveStart(goal), goal.endDate);
  const remaining = getRemainingDays(goal);
  return `
    <section class="goal-hero">
      <div class="hero-topline">
        <span class="status-pill">进行中</span>
        <span class="mini-pill amber">${formatDate(getEffectiveStart(goal))} - ${formatDate(goal.endDate)}</span>
      </div>
      <div>
        <h2>${escapeHtml(goal.title)}</h2>
        <p>${remaining} 天剩余 · 每天约 ${goal.minutes} 分钟 · ${intensityLabel(goal.intensity)}</p>
      </div>
      <div class="progress-wrap">
        <div class="progress-track"><div class="progress-bar" style="--progress:${progress.percent}%"></div></div>
        <div class="progress-meta">
          <span>${progress.done}/${progress.total || "未细化"} 个细项</span>
          <span>${progress.percent}%</span>
        </div>
      </div>
      <div class="metric-grid">
        <div class="metric"><b>${totalDays}</b><span>目标天数</span></div>
        <div class="metric"><b>${goal.phases.length}</b><span>阶段</span></div>
        <div class="metric"><b>${goal.revisions.length}</b><span>调整</span></div>
      </div>
    </section>
  `;
}

function renderToday() {
  state.goals.forEach(ensureTodayPlan);
  const todayTasks = state.goals.flatMap((goal) => getTodayTasks(goal).map((task) => ({ goal, task })));
  const doneToday = todayTasks.filter(({ task }) => task.done).length;

  els.app.innerHTML = `
    <div class="stack">
      <section class="goal-hero">
        <div class="hero-topline">
          <span class="status-pill">${state.goals.length} 个进行中</span>
          <span class="mini-pill amber">${doneToday}/${todayTasks.length || 0} 今日细项</span>
        </div>
        <div>
          <h2>今天处理所有计划</h2>
          <p>每个长期目标保留自己的路线、任务和归档；今日页只把它们聚合到一起，方便逐个打卡。</p>
        </div>
        <div class="metric-grid">
          <div class="metric"><b>${state.goals.length}</b><span>计划</span></div>
          <div class="metric"><b>${todayTasks.length}</b><span>今日任务</span></div>
          <div class="metric"><b>${doneToday}</b><span>已完成</span></div>
        </div>
      </section>
      ${state.goals.map(renderTodayGoal).join("")}
    </div>
  `;
}

function renderTodayGoal(goal) {
  ensureTodayPlan(goal);
  const today = todayISO();
  const plan = goal.dailyPlans[today];
  const activePhase = currentPhase(goal);
  const progress = getGoalProgress(goal);

  let dayContent = "";
  if (today < getEffectiveStart(goal)) {
    dayContent = `
      <div class="panel-note">
        <p class="eyebrow">还没开始</p>
        <h2>${formatDateLong(getEffectiveStart(goal))} 开始执行</h2>
        <p>路线已经准备好，开始当天会展示第一阶段的每日细项。</p>
      </div>
    `;
  } else if (today > goal.endDate) {
    dayContent = `
      <div class="panel-note">
        <p class="eyebrow">目标周期已结束</p>
        <h2>可以归档，也可以延长截止日</h2>
      </div>
    `;
  } else {
    dayContent = `
      <div class="task-list">
        ${(plan?.tasks || []).map((task) => renderTask(task, goal)).join("")}
      </div>
    `;
  }

  return `
    <section class="panel today-goal" data-goal-id="${goal.id}">
      <div class="card-topline">
        <div>
          <p class="eyebrow">${formatDateLong(today)}</p>
          <h2>${escapeHtml(goal.title)}</h2>
          <p>${today >= getEffectiveStart(goal) && today <= goal.endDate ? activePhase.title : `${formatDate(getEffectiveStart(goal))} - ${formatDate(goal.endDate)}`}</p>
        </div>
        <span class="mini-pill blue">${plan?.tasks.filter((task) => task.done).length || 0}/${plan?.tasks.length || 0}</span>
      </div>
      <div class="progress-wrap">
        <div class="progress-track"><div class="progress-bar" style="--progress:${progress.percent}%"></div></div>
        <div class="progress-meta">
          <span>${progress.done}/${progress.total || "未细化"} 总细项</span>
          <span>${progress.percent}%</span>
        </div>
      </div>
      ${dayContent}
      <div class="inline-actions">
        <button class="secondary-button" data-action="view-roadmap" data-goal-id="${goal.id}">${icon("flag")} 路线</button>
        <button class="secondary-button" data-action="open-revise" data-goal-id="${goal.id}">${icon("arrow")} 调整</button>
        <button class="primary-button" data-action="start-first" data-goal-id="${goal.id}">${icon("timer")} 专注</button>
      </div>
    </section>
  `;
}

function renderTask(task, goal) {
  return `
    <article class="task-card ${task.done ? "completed" : ""}" data-goal-id="${goal.id}" data-task-id="${task.id}" data-action="toggle-task">
      <div class="task-row">
        <div class="task-main">
          <h3>${escapeHtml(task.title)}</h3>
          <p>${escapeHtml(task.detail)} · ${task.minutes} 分钟</p>
        </div>
        <div class="checkbox" aria-hidden="true">${icon("check")}</div>
      </div>
      <div class="inline-actions">
        <button class="small-action" data-action="focus-task" data-goal-id="${goal.id}" data-task-id="${task.id}">${icon("timer")} 专注</button>
        <button class="small-action" data-action="open-revise" data-goal-id="${goal.id}">${icon("arrow")} 调整</button>
      </div>
    </article>
  `;
}

function renderGoalSwitcher() {
  if (state.goals.length <= 1) return "";
  return `
    <section class="panel">
      <p class="eyebrow">当前计划</p>
      <div class="goal-switcher">
        ${state.goals.map((goal) => `
          <button class="goal-chip ${goal.id === state.activeGoalId ? "active" : ""}" data-action="select-goal" data-goal-id="${goal.id}">
            ${escapeHtml(goal.title)}
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderRoadmap(goal) {
  if (!goal) {
    renderEmpty();
    return;
  }
  els.app.innerHTML = `
    <div class="stack">
      ${renderGoalSwitcher()}
      ${renderGoalHero(goal)}
      <section class="panel">
        <div class="card-topline">
          <div>
            <p class="eyebrow">阶段路线图</p>
            <h2>先有方向，执行时再细化</h2>
          </div>
        </div>
        <div class="phase-list">
          ${goal.phases.map((phase) => renderPhase(goal, phase)).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="inline-actions">
          <button class="danger-button" data-action="abandon-goal">放弃并归档</button>
          <button class="primary-button" data-action="complete-goal">完成归档</button>
        </div>
      </section>
    </div>
  `;
}

function renderPhase(goal, phase) {
  const isCurrent = currentPhase(goal)?.id === phase.id;
  const plans = Object.values(goal.dailyPlans).filter((day) => day.phaseId === phase.id);
  return `
    <article class="phase-card ${isCurrent ? "current" : ""}">
      <div class="phase-top">
        <div>
          <p class="eyebrow">${formatDate(phase.startDate)} - ${formatDate(phase.endDate)}</p>
          <h3>${escapeHtml(phase.title)}</h3>
        </div>
        <span class="mini-pill ${phase.expanded ? "" : "amber"}">${phase.expanded ? "已细化" : "未细化"}</span>
      </div>
      <p>${escapeHtml(phase.outcome)}</p>
      ${phase.expanded ? `
        <div class="phase-details">
          ${plans.slice(0, 4).map((day) => `
            <div class="daily-line">
              <b>${formatDate(day.date)}</b>
              <p>${day.tasks.map((task) => task.title).join("、")}</p>
            </div>
          `).join("")}
          ${plans.length > 4 ? `<p>还有 ${plans.length - 4} 天细项，进入当天可继续查看。</p>` : ""}
        </div>
      ` : `
        <button class="secondary-button" data-action="expand-phase" data-phase-id="${phase.id}">细化这个阶段</button>
      `}
    </article>
  `;
}

function renderFocus(goal) {
  goal = getTimerGoal() || goal;
  if (!goal) {
    renderEmpty();
    return;
  }
  const task = findTaskById(goal, state.timer.taskId) || findFirstOpenTask(goal);
  if (task && (task.id !== state.timer.taskId || state.timer.goalId !== goal.id)) setTimerTask(task, goal, false);
  const seconds = state.timer.secondsLeft;
  const progress = state.timer.totalSeconds ? 360 - Math.round((seconds / state.timer.totalSeconds) * 360) : 0;
  els.app.innerHTML = `
    <div class="stack">
      ${renderGoalSwitcher()}
      <section class="panel timer-panel">
        <div>
          <p class="eyebrow">当前专注</p>
          <h2>${escapeHtml(state.timer.taskTitle || task?.title || "选择一个任务开始")}</h2>
        </div>
        <div class="timer-ring" style="--timer-progress:${progress}deg">
          <div class="timer-core">
            <div>
              <div class="timer-time">${formatSeconds(seconds)}</div>
              <div class="timer-label">${state.timer.running ? "正在专注" : "准备开始"}</div>
            </div>
          </div>
        </div>
        <div class="timer-controls">
          <button class="timer-control" data-action="toggle-timer">
            ${state.timer.running ? icon("pause") : icon("play")}
            ${state.timer.running ? "暂停" : "开始"}
          </button>
          <button class="timer-control secondary" data-action="reset-timer">${icon("rotate")} 重置</button>
        </div>
        <button class="primary-button" data-action="finish-focus">${icon("check")} 完成本轮并打卡</button>
      </section>
      <section class="panel">
        <p class="eyebrow">可选任务</p>
        <div class="task-list">
          ${getTodayTasks(goal).map((task) => renderTask(task, goal)).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderHistory() {
  const selected = state.archivedGoals.find((goal) => goal.id === state.selectedHistoryId);
  if (selected) {
    renderHistoryDetail(selected);
    return;
  }
  els.app.innerHTML = `
    <div class="stack">
      <section class="panel">
        <p class="eyebrow">目标档案</p>
        <h2>完成和放弃都保留痕迹</h2>
        <p>这里会沉淀每个长期目标的每日任务、调整记录和最终状态。</p>
      </section>
      <div class="history-list">
        ${state.archivedGoals.length ? state.archivedGoals.map(renderHistoryCard).join("") : `
          <section class="empty-state">
            <h2>还没有历史记录。</h2>
            <p>完成或放弃一个目标后，它会出现在这里。</p>
          </section>
        `}
      </div>
    </div>
  `;
}

function renderHistoryCard(goal) {
  const progress = getGoalProgress(goal);
  return `
    <article class="history-card" data-action="open-history" data-goal-id="${goal.id}">
      <div class="history-top">
        <span class="status-pill">${goal.status === "completed" ? "已完成" : "已放弃"}</span>
        <span class="mini-pill amber">${progress.percent}%</span>
      </div>
      <h3>${escapeHtml(goal.title)}</h3>
      <p>${formatDate(getEffectiveStart(goal))} - ${formatDate(goal.endDate)} · 完成 ${progress.done}/${progress.total} 个细项 · 调整 ${goal.revisions.length} 次</p>
    </article>
  `;
}

function renderHistoryDetail(goal) {
  const progress = getGoalProgress(goal);
  const days = Object.values(goal.dailyPlans).sort((a, b) => a.date.localeCompare(b.date));
  els.app.innerHTML = `
    <div class="stack">
      <section class="goal-hero">
        <div class="hero-topline">
          <span class="status-pill">${goal.status === "completed" ? "已完成" : "已放弃"}</span>
          <span class="mini-pill amber">${progress.percent}%</span>
        </div>
        <div>
          <h2>${escapeHtml(goal.title)}</h2>
          <p>${formatDate(getEffectiveStart(goal))} - ${formatDate(goal.endDate)} · ${days.length} 天记录</p>
        </div>
        <div class="progress-wrap">
          <div class="progress-track"><div class="progress-bar" style="--progress:${progress.percent}%"></div></div>
          <div class="progress-meta"><span>${progress.done}/${progress.total} 个细项</span><span>${progress.percent}%</span></div>
        </div>
      </section>
      <section class="panel">
        <p class="eyebrow">每日记录</p>
        <div class="journal">
          ${days.map((day) => `
            <div class="journal-day">
              <b>${formatDateLong(day.date)}</b>
              <ul>
                ${day.tasks.map((task) => `<li>${task.done ? "✓" : "□"} ${escapeHtml(task.title)}：${escapeHtml(task.detail)}</li>`).join("")}
              </ul>
            </div>
          `).join("")}
        </div>
      </section>
      ${goal.revisions.length ? `
        <section class="panel">
          <p class="eyebrow">调整记录</p>
          ${goal.revisions.map((revision) => `<p>${new Date(revision.at).toLocaleString("zh-CN")}：${escapeHtml(revision.feedback)}</p>`).join("")}
        </section>
      ` : ""}
    </div>
  `;
}

function getTimerGoal() {
  return getGoalById(state.timer.goalId) || null;
}

function setTimerTask(task, goal, shouldRender = true) {
  state.activeGoalId = goal.id;
  state.timer.goalId = goal.id;
  state.timer.taskId = task.id;
  state.timer.taskTitle = task.title;
  state.timer.totalSeconds = Math.max(10, task.minutes) * 60;
  state.timer.secondsLeft = state.timer.totalSeconds;
  state.timer.running = false;
  if (shouldRender) {
    state.view = "focus";
    saveState();
    render();
  }
}

function ensureTimer() {
  if (state.timer.running && !timerTick) {
    startTimerLoop();
  }
}

function startTimerLoop() {
  stopTimerLoop();
  timerTick = setInterval(() => {
    if (!state.timer.running) return;
    state.timer.secondsLeft = Math.max(0, state.timer.secondsLeft - 1);
    if (state.timer.secondsLeft === 0) {
      state.timer.running = false;
      stopTimerLoop();
      toast("本轮番茄完成，可以打卡了");
    }
    saveState();
    if (state.view === "focus") renderFocus(getTimerGoal() || getActiveGoal());
  }, 1000);
}

function stopTimerLoop() {
  if (timerTick) clearInterval(timerTick);
  timerTick = null;
}

function findTaskById(goal, taskId) {
  if (!goal || !taskId) return null;
  return getAllGeneratedTasks(goal).find((task) => task.id === taskId) || null;
}

function getTodayTasks(goal) {
  ensureTodayPlan(goal);
  return goal.dailyPlans[todayISO()]?.tasks || [];
}

function findFirstOpenTask(goal) {
  return getTodayTasks(goal).find((task) => !task.done) || getTodayTasks(goal)[0] || null;
}

function toggleTask(goal, taskId, forceDone = null) {
  const task = findTaskById(goal, taskId);
  if (!task) return;
  const nextDone = forceDone === null ? !task.done : forceDone;
  task.done = nextDone;
  task.completedAt = nextDone ? new Date().toISOString() : null;
  saveState();
  render();
}

function finishFocus(goal) {
  const task = findTaskById(goal, state.timer.taskId);
  if (task) {
    task.done = true;
    task.completedAt = new Date().toISOString();
  }
  goal.focusSessions.push({
    id: uid("focus"),
    taskId: task?.id || null,
    taskTitle: task?.title || state.timer.taskTitle,
    minutes: Math.round((state.timer.totalSeconds - state.timer.secondsLeft) / 60),
    at: new Date().toISOString(),
  });
  state.timer.running = false;
  state.timer.secondsLeft = state.timer.totalSeconds;
  stopTimerLoop();
  saveState();
  render();
  toast("已记录本轮专注");
}

function openGoalDialog() {
  const today = todayISO();
  els.goalForm.reset();
  els.goalForm.elements.startDate.value = today;
  els.goalForm.elements.endDate.value = addDays(today, 29);
  els.goalForm.elements.includeStart.checked = true;
  els.goalForm.elements.minutes.value = "45";
  els.goalForm.elements.intensity.value = "steady";
  els.goalDialog.showModal();
}

function icon(name) {
  const icons = {
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 14.4 8.6 20 11l-5.6 2.4L12 19l-2.4-5.6L4 11l5.6-2.4Z"/></svg>',
    timer: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 13V8M9 2h6M15 5l2-2"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2v4M16 2v4M3 10h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
    rotate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v6h6"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20V4M6 5h10l-1.5 3L16 11H6"/></svg>',
  };
  return icons[name] || "";
}

function intensityLabel(value) {
  return { gentle: "轻量节奏", steady: "标准节奏", sprint: "冲刺节奏" }[value] || "标准节奏";
}

function formatSeconds(total) {
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = Math.floor(total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  let node = document.querySelector(".toast");
  if (!node) {
    node = document.createElement("div");
    node.className = "toast";
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 2200);
}

document.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;
  const action = actionTarget.dataset.action;
  const goal = getGoalFromAction(actionTarget) || getActiveGoal();

  if (action === "open-goal") openGoalDialog();
  if (action === "toggle-task" && goal) toggleTask(goal, actionTarget.dataset.taskId);
  if (action === "focus-task" && goal) {
    event.stopPropagation();
    const task = findTaskById(goal, actionTarget.dataset.taskId);
    if (task) setTimerTask(task, goal);
  }
  if (action === "start-first" && goal) {
    const task = findFirstOpenTask(goal);
    if (task) setTimerTask(task, goal);
  }
  if (action === "view-roadmap" && goal) {
    state.activeGoalId = goal.id;
    state.view = "roadmap";
    state.selectedHistoryId = null;
    saveState();
    render();
  }
  if (action === "select-goal" && goal) {
    state.activeGoalId = goal.id;
    state.timer.goalId = state.timer.goalId && state.timer.goalId !== goal.id ? null : state.timer.goalId;
    state.timer.taskId = state.timer.goalId ? state.timer.taskId : null;
    state.timer.taskTitle = state.timer.goalId ? state.timer.taskTitle : "";
    saveState();
    render();
  }
  if (action === "open-revise" && goal) {
    event.stopPropagation();
    state.activeGoalId = goal.id;
    els.reviseForm.reset();
    els.reviseDialog.showModal();
  }
  if (action === "change-date" && goal) {
    state.activeGoalId = goal.id;
    els.dateForm.elements.endDate.value = goal.endDate;
    els.dateDialog.showModal();
  }
  if (action === "expand-phase" && goal) {
    generateDailyPlansForPhase(goal, actionTarget.dataset.phaseId, "手动细化阶段");
    saveState();
    render();
    toast("这个阶段已经细化");
  }
  if (action === "complete-goal" && goal) {
    archiveGoal(goal, "completed");
    toast("已归档为完成");
  }
  if (action === "abandon-goal" && goal) {
    const ok = confirm("确定要放弃并归档这个目标吗？历史记录仍会保留。");
    if (ok) {
      archiveGoal(goal, "abandoned");
      toast("已归档为放弃");
    }
  }
  if (action === "toggle-timer") {
    state.timer.running = !state.timer.running;
    if (state.timer.running) startTimerLoop();
    else stopTimerLoop();
    saveState();
    render();
  }
  if (action === "reset-timer") {
    state.timer.running = false;
    state.timer.secondsLeft = state.timer.totalSeconds;
    stopTimerLoop();
    saveState();
    render();
  }
  if (action === "finish-focus" && goal) finishFocus(goal);
  if (action === "open-history") {
    state.selectedHistoryId = actionTarget.dataset.goalId;
    saveState();
    render();
  }
});

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.view = tab.dataset.view;
    state.selectedHistoryId = null;
    saveState();
    render();
  });
});

els.newGoalButton.addEventListener("click", openGoalDialog);

els.backButton.addEventListener("click", () => {
  state.selectedHistoryId = null;
  saveState();
  render();
});

els.goalForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(els.goalForm);
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");
  const includeStart = formData.get("includeStart") === "on";
  const effectiveStart = includeStart ? startDate : addDays(startDate, 1);

  if (endDate < effectiveStart) {
    toast("结束日期不能早于有效开始日期");
    return;
  }

  const goal = createGoalPlan({
    title: formData.get("goal").trim(),
    startDate,
    endDate,
    includeStart,
    minutes: formData.get("minutes"),
    intensity: formData.get("intensity"),
    preference: formData.get("preference").trim(),
  });

  state.goals.unshift(goal);
  state.activeGoalId = goal.id;
  state.view = "today";
  state.selectedHistoryId = null;
  saveState();
  els.goalDialog.close();
  render();
  toast("路线图已生成");
});

els.reviseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const goal = getActiveGoal();
  if (!goal) return;
  const feedback = new FormData(els.reviseForm).get("feedback").trim();
  reviseFuturePlans(goal, feedback);
  saveState();
  els.reviseDialog.close();
  render();
  toast("后续计划已重排");
});

els.dateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const goal = getActiveGoal();
  if (!goal) return;
  const endDate = new FormData(els.dateForm).get("endDate");
  if (extendOrShrinkGoal(goal, endDate)) {
    saveState();
    els.dateDialog.close();
    render();
    toast("截止日已调整");
  }
});

render();
