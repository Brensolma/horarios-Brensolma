package ar.com.brensolma.horarios;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import com.google.androidbrowserhelper.trusted.LauncherActivity;

/** Widget de la pantalla de inicio: "Marcar" abre la app lista para la próxima marca; "Ticket" abre Viáticos. */
public class WidgetMarcar extends AppWidgetProvider {
    private static final String BASE = "https://horarios-brensolma.onrender.com/";

    private static PendingIntent abrir(Context ctx, String accion, int codigo) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(BASE + "?accion=" + accion));
        i.setClass(ctx, LauncherActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, codigo, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_marcar);
            v.setOnClickPendingIntent(R.id.btn_marcar, abrir(ctx, "marcar", 1));
            v.setOnClickPendingIntent(R.id.btn_ticket, abrir(ctx, "ticket", 2));
            mgr.updateAppWidget(id, v);
        }
    }
}
