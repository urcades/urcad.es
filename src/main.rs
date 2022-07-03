use dioxus::{prelude::*};

fn main() {
    dioxus::web::launch(app);
}

fn app(cx: Scope) -> Element {
    cx.render(rsx!{
        div {
            font_size: "1.256rem",
            padding: "1.128rem 2.512rem",
            p {"É. Urcades"}
            p {"Tlon Corporation"}
            p {"ed@tlon.io"}
            p {
              margin_left: "-.6rem",
              "~fabled-faster"
            }
            p {"Everybody deserves a new computer."}
            a {
              text_decoration: "none",
              href: "https://fabled-faster.tlon.network/writing",
              "Writing"
            }
        }
    })
}