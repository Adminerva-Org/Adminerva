import java.awt.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.List;
import javax.swing.*;

public final class SwingProbe {
  private static String esc(String value){
    if(value==null)return "";
    return value.replace("\\","\\\\").replace(""","\\"").replace("\n","\\n").replace("\r","\\r");
  }
  private static void walk(Component c, Map<String,Integer> counts, List<String> buttons){
    String key=c.getClass().getSimpleName();
    counts.put(key,counts.getOrDefault(key,0)+1);
    if(c instanceof AbstractButton b && b.getText()!=null && !b.getText().isBlank() && buttons.size()<30)
      buttons.add(b.getText());
    if(c instanceof Container container)
      for(Component child:container.getComponents())walk(child,counts,buttons);
  }
  public static void main(String[] args) throws Exception {
    if(args.length!=1)throw new IllegalArgumentException("Main class required");
    final Throwable[] failure=new Throwable[1];
    Thread main=new Thread(()->{
      try{
        Class<?> type=Class.forName(args[0]);
        Method method=type.getMethod("main",String[].class);
        method.invoke(null,(Object)new String[0]);
      }catch(Throwable error){
        failure[0]=error instanceof InvocationTargetException && error.getCause()!=null?error.getCause():error;
      }
    },"adminerva-student-main");
    main.setDaemon(true);main.start();

    long deadline=System.currentTimeMillis()+6000;
    Window[] windows=new Window[0];
    while(System.currentTimeMillis()<deadline){
      Thread.sleep(150);
      final Window[][] holder=new Window[1][];
      SwingUtilities.invokeAndWait(()->holder[0]=Window.getWindows());
      windows=holder[0];
      boolean visible=false;
      for(Window w:windows)if(w.isVisible()){visible=true;break;}
      if(visible)break;
      if(failure[0]!=null)break;
    }
    Map<String,Integer> counts=new TreeMap<>();
    List<String> buttons=new ArrayList<>(),titles=new ArrayList<>();
    int visible=0;
    for(Window window:windows){
      if(!window.isVisible())continue;
      visible++;
      if(window instanceof Frame f && f.getTitle()!=null)titles.add(f.getTitle());
      else if(window instanceof Dialog d && d.getTitle()!=null)titles.add(d.getTitle());
      walk(window,counts,buttons);
    }
    StringBuilder json=new StringBuilder();
    json.append("{\"visibleWindows\":").append(visible)
      .append(",\"buttons\":").append(counts.getOrDefault("JButton",0))
      .append(",\"textFields\":").append(counts.getOrDefault("JTextField",0))
      .append(",\"tables\":").append(counts.getOrDefault("JTable",0))
      .append(",\"textAreas\":").append(counts.getOrDefault("JTextArea",0))
      .append(",\"comboBoxes\":").append(counts.getOrDefault("JComboBox",0))
      .append(",\"windowTitles\":[");
    for(int i=0;i<titles.size();i++){if(i>0)json.append(",");json.append("\"").append(esc(titles.get(i))).append("\"");}
    json.append("],\"buttonLabels\":[");
    for(int i=0;i<buttons.size();i++){if(i>0)json.append(",");json.append("\"").append(esc(buttons.get(i))).append("\"");}
    json.append("]");
    if(failure[0]!=null)json.append(",\"mainError\":\"").append(esc(failure[0].toString())).append("\"");
    json.append("}");
    System.err.println("__ADMINERVA_GUI__"+json);
    System.exit(visible>0?0:(failure[0]!=null?31:30));
  }
}
