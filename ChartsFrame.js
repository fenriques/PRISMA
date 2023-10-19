#include <pjsr/ProcessExitStatus.jsh>
#include <pjsr/Sizer.jsh>

function ChartsFrame(parent, frame_list )
{
    this.__base__ = Frame;
    this.__base__(parent);
    this.frame_list = frame_list;
    this.repaint();

    function run( program, maxRunningTimeSec )
    {
        if ( maxRunningTimeSec === undefined )
            maxRunningTimeSec = 10;
        var P = new ExternalProcess( program );
        if ( P.waitForStarted() )
        {
            processEvents();
            var n = 0;
            var nmax = Math.round( maxRunningTimeSec*1000/250 );
            for ( ; n < nmax && !P.waitForFinished( 250 ); ++n )
            {
                console.write( "<end>\b" + "-/|\\".charAt( n%4 ) );
                processEvents();
            }
            if ( n > 0 )
                console.writeln( "<end>\b" );
        }
        if ( P.exitStatus == ProcessExitStatus_Crash || P.exitCode != 0 )
        {
            var e = P.stderr;
            throw new ParseError( "Process failed:\n" + program +
                                    ((e.length > 0) ? "\n" + e : ""), tokens, index );
        }
    }
    function filterColorCode(filter)
    {
       var L = ["L", "Lum", "Luminance"];
       var R = ["R", "Red"];
       var G = ["G", "Green"];
       var B = ["B", "Blue"];
       var H = ["H", "Ha", "HAlpha", "H_Alpha"];
       var S = ["S", "Sii", "SII", "S2"];
       var O = ["O", "Oiii", "OIII", "O3"];
 
       if(L.indexOf(filter)!==-1) return 0x000000;
       if(R.indexOf(filter)!==-1) return 0xAA0000;
       if(G.indexOf(filter)!==-1) return 0x00AA00;
       if(B.indexOf(filter)!==-1) return 0x0000AA;
       if(H.indexOf(filter)!==-1) return 0x006600;
       if(S.indexOf(filter)!==-1) return 0xAA6600;
       if(O.indexOf(filter)!==-1) return 0x0066FF;
 
       return 0x000000;
    };
    this.frame_list = frame_list;
    if(frame_list.length > 0) 
    {
        var tmpDir = File.systemTempDirectory;
        var gnuFilePath = tmpDir + "/spline.gnu";
        var f = new File;

        f.createForWriting( gnuFilePath );

        f.outTextLn(    "reset\n"
                        +"set terminal svg size 400,300 antialias  enhanced font 'helvetica,12'\n"
                        +"set output 'simple.svg' \n"
                        +"$Mydata << EOD \n");
        for ( var i = 0; i < this.frame_list.length; ++i )
        {
            f.outTextLn(this.frame_list[i].dateobs + " " + Number(this.frame_list[i].fwhm).toFixed(2) + " " + (filterColorCode(this.frame_list[i].filter)));
        }
        f.outTextLn( "EOD \n"
                    +"set xdata time \n"
                    +"set timefmt '%Y-%m-%dT%H:%M:%S' \n"
                    +"set format x '%m-%d %H:%M' \n"
                    +"set xrange [*:*] \n"
                    +"set yrange [*:*]  \n"
                    +"set ylabel 'FWHM'  \n"
                    +"set key off  \n"
                    +"set grid \n"
                    +"set object 1 rectangle from graph 0, graph 0 to graph 1, graph 1 behind fc rgbcolor 'white' fs noborder \n"
                    +"set xtics rotate by -60 \n"
                    +"plot $Mydata using 1:2:3 with points pointtype 7 lc rgb variable,\
                     $Mydata using 1:2:3 with points pointtype 6 lc rgb '#444444'\n" );
        f.close();
        

        try 
        {
            run( "\"" + getEnvironmentVariable( "PXI_BINDIR" ) + "/gnuplot\" \"" + gnuFilePath + "\"" );
        }catch(e){
            console.warningln(e);
        }

        this.bitmap = new Bitmap();
        this.bitmap.load("/home/ferrante/simple.svg");
        this.bitmapControl = new Control( this );
        //this.bitmapControl.setScaledMinSize( 320, 200);
        this.bitmapControl.onPaint = function()
        {
            let g = new Graphics( this );
            g.drawBitmap( 0, 0,  this.parent.bitmap.scaledTo(300));
            g.antialiasing = true;
            g.end();
        };

        this.sizer = new HorizontalSizer( this );
        this.sizer.margin = 8;
        this.sizer.add( this.bitmapControl);

        this.adjustToContents();
    }
}

ChartsFrame.prototype = new Frame;

/*
PlotDialog.prototype = new Dialog;
(new PlotDialog()).execute();
*/