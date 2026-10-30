import {
  type Project,
  type Entity,
  newEntity,
  plain,
  charCount,
} from "../shared/domain.js";
export function checkProject(p: Project) {
  const issues: Entity[] = [];
  const all = p.data.entities;
  const add = (
    key: string,
    title: string,
    e: Entity,
    severity: string,
    evidence: string,
    suggestion: string,
  ) => {
    const prev = all.find(
      (x) => x.kind === "issue" && x.fields.checkKey === key,
    );
    if (prev && prev.fields.resolution === "有意保留") return;
    const issue = newEntity("issue", title);
    issue.id = prev?.id || issue.id;
    issue.refs = [e.id];
    issue.fields = {
      severity,
      evidence,
      suggestion,
      resolution: "未处理",
      checkKey: key,
    };
    issues.push(issue);
  };
  for (const e of all) {
    if (e.refs.some((r) => !all.some((x) => x.id === r)))
      add(
        "refs:" + e.id,
        "关联对象缺失",
        e,
        "阻断",
        "存在无法定位的引用",
        "恢复对象或解除关联",
      );
    if (e.stale)
      add(
        "stale:" + e.id,
        "上游内容已调整",
        e,
        "待审",
        "引用的设定或场景发生了变化",
        "对照最新依据检查此处",
      );
    if (e.kind === "document") {
      const count = charCount(e.body);
      if (e.fields.minChars && count < Number(e.fields.minChars))
        add(
          "short:" + e.id,
          "正文篇幅不足",
          e,
          "阻断",
          `实际 ${count} 字符，要求至少 ${e.fields.minChars}`,
          "保持原剧情扩写指定范围",
        );
      if (e.fields.maxChars && count > Number(e.fields.maxChars))
        add(
          "long:" + e.id,
          "正文超过篇幅",
          e,
          "提示",
          `实际 ${count} 字符，上限 ${e.fields.maxChars}`,
          "压缩重复叙述",
        );
      if (
        e.fields.startsWith &&
        !plain(e.body).startsWith(String(e.fields.startsWith))
      )
        add(
          "start:" + e.id,
          "固定开头不匹配",
          e,
          "阻断",
          String(e.fields.startsWith),
          "恢复约定开头",
        );
      if (
        !e.refs.some((r) => all.find((x) => x.id === r)?.kind === "character")
      )
        add(
          "character:" + e.id,
          "正文尚未关联人物",
          e,
          "提示",
          "角色归属未指定",
          "添加人物关联，便于分角色交付",
        );
      for (const rule of all.filter(
        (x) =>
          x.kind === "constraint" &&
          x.fields.forbidden &&
          (!x.refs.length ||
            x.refs.includes(e.id) ||
            e.refs.some((r) => x.refs.includes(r))),
      )) {
        for (const word of String(rule.fields.forbidden)
          .split(/[、,，\n]/)
          .filter(Boolean))
          if (plain(e.body).includes(word))
            add(
              "word:" + e.id + ":" + word,
              "出现禁用表达",
              e,
              "待审",
              `发现“${word}”`,
              "核对适用范围及引用语境",
            );
      }
    }
    if (
      ["clue", "object", "memory"].includes(e.kind) &&
      !e.fields.payoff &&
      e.kind !== "memory"
    )
      add(
        "payoff:" + e.id,
        "回收位置未明确",
        e,
        "提示",
        "条目没有标明后续用途",
        "补充回收场景或说明独立作用",
      );
    if (e.kind === "performance") {
      for (const key of ["silent", "refuse", "unexpected"])
        if (!e.fields[key])
          add(
            "branch:" + e.id + key,
            "演绎分支待补充",
            e,
            "待审",
            (
              {
                silent: "玩家沉默",
                refuse: "玩家拒绝",
                unexpected: "意外提问",
              } as any
            )[key],
            "为此情况设计可继续的回应",
          );
    }
  }
  const performances = all.filter((e) => e.kind === "performance");
  for (let i = 0; i < performances.length; i++)
    for (let j = i + 1; j < performances.length; j++) {
      const a = performances[i],
        b = performances[j],
        overlap =
          Number(a.fields.start) <
            Number(b.fields.start) + Number(b.fields.duration) &&
          Number(b.fields.start) <
            Number(a.fields.start) + Number(a.fields.duration);
      if (overlap) {
        const people = String(a.fields.performers || "")
          .split(/[、,，]/)
          .filter(Boolean)
          .filter((n) =>
            String(b.fields.performers || "")
              .split(/[、,，]/)
              .includes(n),
          );
        if (
          people.length ||
          (a.fields.place && a.fields.place === b.fields.place)
        )
          add(
            "schedule:" + a.id + b.id,
            "演绎资源时段冲突",
            a,
            "阻断",
            `与“${b.title}”重叠：${people.join("、") || a.fields.place}`,
            "调整时间、演员或场地",
          );
      }
    }
  return issues;
}
