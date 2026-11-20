from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from studioapp import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("studioapp.urls")),
    path("preview/<slug:name>.wav", views.preview_audio, name="preview-audio"),
    path("", views.home, name="home"),
    path("create", views.create, name="create"),
    path("studio", views.studio, name="studio"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
