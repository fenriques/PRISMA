function ImagePreview(parent, image, metadata)
{
   this.__base__ = Frame;
   this.__base__(parent);

   this.image = image;
   this.metadata = metadata;

   var bm = this.image.render();
   this.bitmap = new Bitmap(bm);
   this.bitmapControl = new Control( this );
   this.imageRatio = Number(800*(this.metadata.height / this.metadata.width)).toFixed(1);
 
   
   this.bitmapControl.setScaledMinSize( 800, Number(this.imageRatio ));
   this.bitmapControl.onPaint = function()
   {
      let g = new Graphics( this );
      g.drawBitmap( 0, 0,  this.parent.bitmap.scaledTo( 800 , Number(this.parent.imageRatio )));
      g.end();
   };

   this.sizer = new HorizontalSizer( this );
   this.sizer.margin = 8;
   this.sizer.add( this.bitmapControl, 100 );

   this.adjustToContents();



}
ImagePreview.prototype = new Frame;
