const profileButton = document.getElementById("profileButton");
const profileWrapper = document.querySelector(".profile-menu-wrapper");
const profileDropdown = document.getElementById("profileDropdown");

if (profileButton && profileWrapper) {

    profileButton.addEventListener("click", function (event) {
        event.stopPropagation();

        profileWrapper.classList.toggle("open");
    });

    document.addEventListener("click", function () {
        profileWrapper.classList.remove("open");
    });

    if (profileDropdown) {
        profileDropdown.addEventListener("click", function (event) {
            event.stopPropagation();
        });
    }
}