from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import MusicJobViewSet, StudioProjectViewSet, login_view, logout_view, provider_status, register_view

router = DefaultRouter()
router.register("jobs", MusicJobViewSet, basename="job")
router.register("projects", StudioProjectViewSet, basename="project")
urlpatterns = [
    path("provider/", provider_status, name="provider-status"),
    path("auth/register/", register_view, name="register"),
    path("auth/login/", login_view, name="login"),
    path("auth/logout/", logout_view, name="logout"),
    path("", include(router.urls)),
    path("auth/", include("rest_framework.urls")),
]
