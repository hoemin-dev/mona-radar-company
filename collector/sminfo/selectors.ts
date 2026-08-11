export const SMINFO_SELECTORS = {
  login: {
    id: "#login_id",
    password: "#login_password",
    submit: "button.login_btn[onclick*='fnLogin']",
  },
  company: {
    resultLink: "a[onclick*='onMoveView01']",
    listButton: 'input[type=button][value="목록"],input[type=submit][value="목록"]',
  },
  industry: { finderText: "산업코드찾기", searchText: "검색" },
} as const;
