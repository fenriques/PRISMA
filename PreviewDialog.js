#include <pjsr/Sizer.jsh>

function PreviewDialog( image, metadata )
{
   this.__base__ = Dialog;
   this.__base__();
   this.metadata = metadata;
   this.previewFrame = new ImagePreview( this,image, this.metadata );

   this.userResizable = false;

   this.ok_Button = new PushButton( this );
   this.ok_Button.defaultButton = true;
   this.ok_Button.text = "Close";
   this.ok_Button.icon = this.scaledResource( ":/icons/close.png" );
   this.ok_Button.onClick = function()
   {
      this.dialog.ok();
   };

   this.buttons_Sizer = new HorizontalSizer;
   this.buttons_Sizer.spacing = 6;
   this.buttons_Sizer.addStretch();
   this.buttons_Sizer.add( this.ok_Button );

   // Global sizer
   this.sizer = new VerticalSizer;
   this.sizer.margin = 8;
   this.sizer.spacing = 6;
   this.sizer.add( this.previewFrame );
   this.sizer.addSpacing( 2 );
   this.sizer.add( this.buttons_Sizer );

   this.windowTitle = "Image Preview";
   this.adjustToContents();
}

PreviewDialog.prototype = new Dialog;
