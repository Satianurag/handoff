// Marketing illustration stays local; product entry points open the real application.
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const infoDialog = $("#info-dialog");
let previousOverflow = "";

const examples = {
  meal: [
    "SOMETHING HOMEMADE",
    "A warm meal. A clear plan.",
    "<p>Jo brings dinner on Tuesday. Maya knows it’s covered, and Riley knows who to expect.</p><p>A useful responsibility has a clear action, an owner, and a time. Add the practical details—like where to leave the food—so no one has to chase them.</p>",
  ],
  ride: [
    "GOING TOGETHER",
    "The ride, taken care of.",
    "<p>Leo takes Riley to the community clinic at 10:30 am. The west entrance and parking details stay with the visit.</p><p>When a ride changes hands, the next person reviews the context and accepts it. Everyone can see who is taking it on.</p>",
  ],
  call: [
    "A FAMILIAR VOICE",
    "A few minutes can matter.",
    "<p>Maya checks in after breakfast. Leo takes the evening hello. Small responsibilities are easier to share when they have a home.</p><p>Open the sample household to try shared responsibilities with real saved updates.</p>",
  ],
  plan: [
    "A LITTLE CLARITY",
    "Keep the detail with the plan.",
    "<p>The office confirmed a different entrance. Rather than lose that detail in a conversation, keep it next to the visit and include it in the handover.</p><p>Review the source before changing a plan, and make the next action clear to the person taking over.</p>",
  ],
  together: [
    "OUR HOUSEHOLD",
    "Everyone can do something.",
    "<p>One person may live nearby. Another may handle calls. A third may take the occasional ride.</p><p>A shared household brings those different contributions into view. A handover lets someone accept only what they can manage, without silently moving everything onto their plate.</p>",
  ],
};

function openDialog(dialog) {
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  dialog.showModal();
}
function openInfo(content) {
  $("#info-label").textContent = content[0];
  $("#info-title").textContent = content[1];
  // Only fixed, authored copy from the maps above enters this container.
  $("#info-body").innerHTML = content[2];
  openDialog(infoDialog);
}
$$("dialog").forEach((dialog) => {
  $$("[data-close]", dialog).forEach((button) =>
    button.addEventListener("click", () => dialog.close()),
  );
  dialog.addEventListener("close", () => {
    document.body.style.overflow = previousOverflow;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      dialog.close();
  });
});
$$("[data-info]").forEach((button) =>
  button.addEventListener("click", () => { location.assign(button.dataset.info === "privacy" ? "/privacy" : button.dataset.info === "boundaries" ? "/consumer-health-privacy" : "/help"); }),
);
$$("[data-example]").forEach((button) =>
  button.addEventListener("click", () =>
    openInfo(examples[button.dataset.example]),
  ),
);

$$("[data-demo]").forEach(button => button.addEventListener("click", () => {
  location.assign(button.dataset.demo === 'handover' ? '/demo?intent=handover' : '/demo');
}));

const menuButton = $(".menu-button");
const menu = $("#nav-links");
function closeMenu() {
  menu.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
}
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open));
  menu.classList.toggle("open", open);
});
$$("a", menu).forEach((link) => link.addEventListener("click", closeMenu));
document.addEventListener("click", (event) => {
  if (!$(".navigation").contains(event.target)) closeMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menu.classList.contains("open")) {
    closeMenu();
    menuButton.focus();
  }
});
matchMedia("(min-width: 601px)").addEventListener("change", closeMenu);
const track = $(".story-track");
const storyButtons = $$("[data-story]");
function syncStoryButtons() {
  $(".story-controls").hidden = track.scrollWidth <= track.clientWidth + 2;
  storyButtons[0].disabled = track.scrollLeft <= 2;
  storyButtons[1].disabled =
    track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
}
storyButtons.forEach((button) =>
  button.addEventListener("click", () => {
    track.scrollBy({
      left:
        Number(button.dataset.story) *
        ($(".story").getBoundingClientRect().width + 45),
      behavior: reducedMotion.matches ? "instant" : "smooth",
    });
  }),
);
track.addEventListener("scroll", syncStoryButtons, { passive: true });
new ResizeObserver(syncStoryButtons).observe(track);
$("#year").textContent = new Date().getFullYear();

// Keep content visible if animation APIs are unavailable or motion is reduced.
if ("IntersectionObserver" in window && !reducedMotion.matches) {
  document.documentElement.classList.add("js");
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove("waiting");
        observer.unobserve(entry.target);
      }),
    { threshold: 0.08 },
  );
  $$(".reveal").forEach((section) => {
    section.classList.add("waiting");
    observer.observe(section);
  });
}
